import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db.js';
import { publishCommand } from '../mqtt.js';
import { requireAuth, requireRoles, safeTokenEqual } from '../security.js';
import { ingestTelemetry, telemetrySchema } from '../services/telemetry.js';
import type { AuthenticatedRequest } from '../types.js';

export const apiRouter = Router();

apiRouter.post('/device/telemetry', async (request: Request, response: Response) => {
  const parsed = telemetrySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid telemetry', detail: parsed.error.flatten() });
    return;
  }

  const deviceId = request.header('x-device-id');
  const deviceToken = request.header('x-device-token');
  if (!deviceId || !deviceToken || deviceId !== parsed.data.deviceId) {
    response.status(401).json({ error: 'Invalid device identity' });
    return;
  }

  const credential = await query<{ token_hash: string }>(
    `SELECT dc.token_hash
     FROM device_credentials dc JOIN lights l ON l.id = dc.light_id
     WHERE l.asset_code = $1 AND dc.active = TRUE`,
    [deviceId]
  );
  const tokenHash = credential.rows[0]?.token_hash;
  if (!tokenHash || !safeTokenEqual(tokenHash, deviceToken)) {
    response.status(401).json({ error: 'Invalid device credential' });
    return;
  }

  try {
    const result = await ingestTelemetry(parsed.data);
    response.status(result.duplicate ? 200 : 202).json({
      accepted: true,
      duplicate: result.duplicate,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNKNOWN_DEVICE') {
      response.status(404).json({ error: 'Device is not provisioned' });
      return;
    }
    throw error;
  }
});

apiRouter.use(requireAuth);

apiRouter.get('/dashboard', async (_request, response) => {
  const [fleet, alerts, workOrders, energy] = await Promise.all([
    query<{
      total: string; online: string; offline: string; fault: string; maintenance: string;
    }>(
      `SELECT COUNT(*) total,
        COUNT(*) FILTER (WHERE status = 'ONLINE') online,
        COUNT(*) FILTER (WHERE status = 'OFFLINE') offline,
        COUNT(*) FILTER (WHERE status = 'FAULT') fault,
        COUNT(*) FILTER (WHERE status = 'MAINTENANCE') maintenance
       FROM lights WHERE status <> 'RETIRED'`
    ),
    query<{ critical: string; warning: string }>(
      `SELECT
        COUNT(*) FILTER (WHERE severity = 'CRITICAL') critical,
        COUNT(*) FILTER (WHERE severity = 'WARNING') warning
       FROM alerts WHERE status IN ('OPEN', 'ACKNOWLEDGED')`
    ),
    query<{ open: string }>(
      `SELECT COUNT(*) open FROM work_orders WHERE status NOT IN ('COMPLETED', 'CANCELLED')`
    ),
    query<{ today_kwh: string }>(
      `SELECT COALESCE(SUM(power_w) / 60 / 1000, 0)::numeric(14,2) today_kwh
       FROM telemetry WHERE recorded_at >= CURRENT_DATE`
    )
  ]);
  response.json({
    fleet: fleet.rows[0],
    alerts: alerts.rows[0],
    workOrders: workOrders.rows[0],
    energy: energy.rows[0]
  });
});

apiRouter.get('/lights', async (request, response) => {
  const status = typeof request.query.status === 'string' ? request.query.status : null;
  const province = typeof request.query.province === 'string' ? request.query.province : null;
  const result = await query(
    `SELECT l.*, p.code province_code, p.name_en province_name, p.name_km province_name_km
     FROM lights l JOIN provinces p ON p.id = l.province_id
     WHERE ($1::varchar IS NULL OR l.status = $1)
       AND ($2::varchar IS NULL OR p.code = $2)
     ORDER BY l.asset_code LIMIT 1000`,
    [status, province]
  );
  response.json({ items: result.rows });
});

const lightSchema = z.object({
  assetCode: z.string().min(6).max(80).regex(/^KH-[A-Z0-9]{3}-[0-9]{6}$/),
  name: z.string().min(3).max(180),
  provinceCode: z.string().min(3).max(8),
  district: z.string().max(120).optional(),
  road: z.string().max(180).optional(),
  latitude: z.number().min(9.5).max(15),
  longitude: z.number().min(102).max(108),
  nominalWatts: z.number().min(10).max(2000).default(120)
});

apiRouter.post(
  '/lights',
  requireRoles('ADMIN'),
  async (request: AuthenticatedRequest, response) => {
    const parsed = lightSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid light asset', detail: parsed.error.flatten() });
      return;
    }
    const deviceToken = crypto.randomBytes(32).toString('hex');
    try {
      const light = await transaction(async (client) => {
        const result = await client.query<{ id: string; asset_code: string }>(
          `INSERT INTO lights(
             asset_code, name, province_id, district, road, latitude, longitude, nominal_watts
           )
           SELECT $1, $2, id, $4, $5, $6, $7, $8
           FROM provinces WHERE code = $3
           RETURNING id, asset_code`,
          [
            parsed.data.assetCode, parsed.data.name, parsed.data.provinceCode,
            parsed.data.district ?? null, parsed.data.road ?? null,
            parsed.data.latitude, parsed.data.longitude, parsed.data.nominalWatts
          ]
        );
        const created = result.rows[0];
        if (!created) throw new Error('INVALID_PROVINCE');
        const { hashDeviceToken } = await import('../security.js');
        await client.query(
          `INSERT INTO device_credentials(light_id, token_hash) VALUES ($1, $2)`,
          [created.id, hashDeviceToken(deviceToken)]
        );
        await client.query(
          `INSERT INTO audit_logs(actor_user_id, action, target_type, target_id, detail, ip_address)
           VALUES ($1, 'LIGHT_PROVISIONED', 'light', $2, $3, $4)`,
          [request.user?.id, created.id, JSON.stringify({ assetCode: created.asset_code }), request.ip]
        );
        return created;
      });
      response.status(201).json({
        ...light,
        deviceToken,
        warning: 'This device token is shown once. Store it in the approved provisioning system.'
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_PROVINCE') {
        response.status(400).json({ error: 'Province code does not exist' });
        return;
      }
      if ((error as { code?: string }).code === '23505') {
        response.status(409).json({ error: 'Asset code already exists' });
        return;
      }
      throw error;
    }
  }
);

apiRouter.get('/lights/:id', async (request, response) => {
  const [light, telemetry, alerts, commands] = await Promise.all([
    query(
      `SELECT l.*, p.name_en province_name, p.name_km province_name_km
       FROM lights l JOIN provinces p ON p.id = l.province_id WHERE l.id = $1`,
      [request.params.id]
    ),
    query(
      `SELECT * FROM telemetry WHERE light_id = $1 ORDER BY recorded_at DESC LIMIT 120`,
      [request.params.id]
    ),
    query(
      `SELECT * FROM alerts WHERE light_id = $1 ORDER BY opened_at DESC LIMIT 50`,
      [request.params.id]
    ),
    query(
      `SELECT * FROM commands WHERE light_id = $1 ORDER BY issued_at DESC LIMIT 30`,
      [request.params.id]
    )
  ]);
  if (!light.rows[0]) {
    response.status(404).json({ error: 'Light not found' });
    return;
  }
  response.json({ ...light.rows[0], telemetry: telemetry.rows, alerts: alerts.rows, commands: commands.rows });
});

const commandSchema = z.object({
  action: z.enum(['set', 'identify', 'sampleNow', 'restart']),
  on: z.boolean().optional(),
  brightness: z.number().int().min(0).max(100).optional()
}).refine((data) => data.action !== 'set' || data.on !== undefined, {
  message: 'The set command requires on'
});

apiRouter.post(
  '/lights/:id/commands',
  requireRoles('ADMIN', 'OPERATOR'),
  async (request: AuthenticatedRequest, response) => {
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid command', detail: parsed.error.flatten() });
      return;
    }

    const result = await transaction(async (client) => {
      const lightResult = await client.query<{ asset_code: string }>(
        `SELECT asset_code FROM lights WHERE id = $1 AND status <> 'RETIRED' FOR UPDATE`,
        [request.params.id]
      );
      const light = lightResult.rows[0];
      if (!light) return undefined;

      const commandResult = await client.query<{ id: string }>(
        `INSERT INTO commands(light_id, action, payload, issued_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [request.params.id, parsed.data.action, JSON.stringify(parsed.data), request.user?.id]
      );
      const commandId = commandResult.rows[0]!.id;
      if (parsed.data.action === 'set') {
        await client.query(
          `UPDATE lights SET desired_on = $2,
             desired_brightness = COALESCE($3, desired_brightness), updated_at = NOW()
           WHERE id = $1`,
          [request.params.id, parsed.data.on, parsed.data.brightness ?? null]
        );
      }
      await client.query(
        `INSERT INTO audit_logs(actor_user_id, action, target_type, target_id, detail, ip_address)
         VALUES ($1, 'LIGHT_COMMAND_ISSUED', 'light', $2, $3, $4)`,
        [request.user?.id, request.params.id, JSON.stringify(parsed.data), request.ip]
      );
      return { commandId, deviceId: light.asset_code };
    });

    if (!result) {
      response.status(404).json({ error: 'Light not found' });
      return;
    }

    const payload = { commandId: result.commandId, ...parsed.data };
    const published = publishCommand(result.deviceId, payload);
    await query(
      `UPDATE commands SET status = $2 WHERE id = $1`,
      [result.commandId, published ? 'PUBLISHED' : 'QUEUED']
    );
    response.status(202).json({ id: result.commandId, published, command: payload });
  }
);

apiRouter.post('/alerts/:id/acknowledge', async (request: AuthenticatedRequest, response) => {
  const result = await query(
    `UPDATE alerts SET status = 'ACKNOWLEDGED', acknowledged_at = NOW(), acknowledged_by = $2
     WHERE id = $1 AND status = 'OPEN' RETURNING *`,
    [request.params.id, request.user?.id]
  );
  if (!result.rows[0]) {
    response.status(409).json({ error: 'Alert is not open or does not exist' });
    return;
  }
  response.json(result.rows[0]);
});

const workOrderSchema = z.object({
  lightId: z.string().uuid(),
  alertId: z.string().uuid().optional(),
  title: z.string().min(3).max(180),
  description: z.string().max(5000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY']),
  assignedTo: z.string().max(120).optional(),
  dueAt: z.string().datetime().optional()
});

apiRouter.post(
  '/work-orders',
  requireRoles('ADMIN', 'OPERATOR', 'MAINTENANCE'),
  async (request: AuthenticatedRequest, response) => {
    const parsed = workOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid work order', detail: parsed.error.flatten() });
      return;
    }
    const reference = `WO-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const result = await query(
      `INSERT INTO work_orders(
         reference_no, light_id, alert_id, title, description, priority,
         assigned_to, due_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        reference, parsed.data.lightId, parsed.data.alertId ?? null, parsed.data.title,
        parsed.data.description ?? null, parsed.data.priority, parsed.data.assignedTo ?? null,
        parsed.data.dueAt ?? null, request.user?.id
      ]
    );
    response.status(201).json(result.rows[0]);
  }
);

const statusSchema = z.object({
  status: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'])
});

apiRouter.patch(
  '/work-orders/:id/status',
  requireRoles('ADMIN', 'OPERATOR', 'MAINTENANCE'),
  async (request, response) => {
    const parsed = statusSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid status' });
      return;
    }
    const result = await query(
      `UPDATE work_orders SET status = $2, updated_at = NOW(),
         completed_at = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE completed_at END
       WHERE id = $1 RETURNING *`,
      [request.params.id, parsed.data.status]
    );
    if (!result.rows[0]) {
      response.status(404).json({ error: 'Work order not found' });
      return;
    }
    response.json(result.rows[0]);
  }
);
