import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import {
  clearSessionCookie, requireAuth, setSessionCookie, signSession, verifyPassword
} from '../security.js';
import type { AuthenticatedRequest, SessionUser } from '../types.js';

export const webRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

webRouter.get('/login', (request: AuthenticatedRequest, response) => {
  if (request.user) {
    response.redirect('/');
    return;
  }
  response.render('login', { title: 'Sign in', error: null });
});

webRouter.post('/login', loginLimiter, async (request: Request, response: Response) => {
  const username = String(request.body.username ?? '').trim();
  const password = String(request.body.password ?? '');
  const result = await query<SessionUser & { password_hash: string; active: boolean }>(
    `SELECT id, username, role, password_hash, active FROM users WHERE username = $1`,
    [username]
  );
  const user = result.rows[0];
  if (!user?.active || !(await verifyPassword(password, user.password_hash))) {
    response.status(401).render('login', {
      title: 'Sign in',
      error: 'The username or password is incorrect.'
    });
    return;
  }
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
  setSessionCookie(response, signSession({ id: user.id, username: user.username, role: user.role }));
  response.redirect('/');
});

webRouter.post('/logout', (_request, response) => {
  clearSessionCookie(response);
  response.redirect('/login');
});

webRouter.use(requireAuth);

webRouter.get('/', async (request: AuthenticatedRequest, response) => {
  const [fleet, alertStats, workOrders, energy, recentAlerts, provinceStats, mapLights] = await Promise.all([
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
    query<{ critical: string; warning: string; total: string }>(
      `SELECT COUNT(*) total,
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
    ),
    query(
      `SELECT a.*, l.asset_code, l.name light_name, p.name_en province_name
       FROM alerts a JOIN lights l ON l.id = a.light_id
       JOIN provinces p ON p.id = l.province_id
       WHERE a.status IN ('OPEN', 'ACKNOWLEDGED')
       ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
                a.opened_at DESC LIMIT 8`
    ),
    query(
      `SELECT p.code, p.name_en, p.name_km, COUNT(l.id) total,
        COUNT(l.id) FILTER (WHERE l.status = 'ONLINE') online,
        COUNT(l.id) FILTER (WHERE l.status IN ('OFFLINE','FAULT')) attention
       FROM provinces p LEFT JOIN lights l ON l.province_id = p.id AND l.status <> 'RETIRED'
       GROUP BY p.id ORDER BY p.name_en`
    ),
    query(
      `SELECT id, asset_code, name, status, latitude, longitude
       FROM lights WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND status <> 'RETIRED'`
    )
  ]);

  response.render('dashboard', {
    title: 'National operations',
    page: 'dashboard',
    user: request.user,
    fleet: fleet.rows[0] ?? {},
    alerts: alertStats.rows[0] ?? {},
    workOrders: workOrders.rows[0] ?? {},
    energy: energy.rows[0] ?? {},
    recentAlerts: recentAlerts.rows,
    provinceStats: provinceStats.rows,
    mapLights: mapLights.rows
  });
});

webRouter.get('/lights', async (request: AuthenticatedRequest, response) => {
  const status = typeof request.query.status === 'string' ? request.query.status : null;
  const search = typeof request.query.search === 'string' ? request.query.search.trim() : null;
  const [lights, provinces] = await Promise.all([
    query(
      `SELECT l.*, p.code province_code, p.name_en province_name, p.name_km province_name_km
       FROM lights l JOIN provinces p ON p.id = l.province_id
       WHERE ($1::varchar IS NULL OR l.status = $1)
         AND ($2::varchar IS NULL OR l.asset_code ILIKE '%' || $2 || '%' OR l.name ILIKE '%' || $2 || '%')
       ORDER BY l.last_seen_at DESC NULLS LAST, l.asset_code LIMIT 500`,
      [status, search]
    ),
    query(`SELECT code, name_en, name_km FROM provinces ORDER BY name_en`)
  ]);
  response.render('lights', {
    title: 'Street lights', page: 'lights', user: request.user,
    lights: lights.rows, provinces: provinces.rows, status, search
  });
});

webRouter.get('/lights/:id', async (request: AuthenticatedRequest, response) => {
  const [light, telemetry, alerts, commands, workOrders] = await Promise.all([
    query(
      `SELECT l.*, p.name_en province_name, p.name_km province_name_km
       FROM lights l JOIN provinces p ON p.id = l.province_id WHERE l.id = $1`,
      [request.params.id]
    ),
    query(
      `SELECT * FROM telemetry WHERE light_id = $1 ORDER BY recorded_at DESC LIMIT 30`,
      [request.params.id]
    ),
    query(`SELECT * FROM alerts WHERE light_id = $1 ORDER BY opened_at DESC LIMIT 20`, [request.params.id]),
    query(`SELECT * FROM commands WHERE light_id = $1 ORDER BY issued_at DESC LIMIT 15`, [request.params.id]),
    query(`SELECT * FROM work_orders WHERE light_id = $1 ORDER BY created_at DESC LIMIT 15`, [request.params.id])
  ]);
  if (!light.rows[0]) {
    response.status(404).render('error', { title: 'Not found', message: 'Street light not found.' });
    return;
  }
  response.render('light-detail', {
    title: light.rows[0].asset_code, page: 'lights', user: request.user,
    light: light.rows[0], telemetry: telemetry.rows, alerts: alerts.rows,
    commands: commands.rows, workOrders: workOrders.rows
  });
});

webRouter.get('/alerts', async (request: AuthenticatedRequest, response) => {
  const status = typeof request.query.status === 'string' ? request.query.status : 'OPEN';
  const alerts = await query(
    `SELECT a.*, l.asset_code, l.name light_name, l.id light_id, p.name_en province_name
     FROM alerts a JOIN lights l ON l.id = a.light_id
     JOIN provinces p ON p.id = l.province_id
     WHERE ($1 = 'ALL' OR a.status = $1)
     ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
              a.opened_at DESC LIMIT 500`,
    [status]
  );
  response.render('alerts', {
    title: 'Alerts', page: 'alerts', user: request.user, alerts: alerts.rows, status
  });
});

webRouter.get('/maintenance', async (request: AuthenticatedRequest, response) => {
  const orders = await query(
    `SELECT w.*, l.asset_code, l.name light_name, p.name_en province_name
     FROM work_orders w JOIN lights l ON l.id = w.light_id
     JOIN provinces p ON p.id = l.province_id
     ORDER BY CASE w.priority WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
              w.created_at DESC LIMIT 500`
  );
  response.render('maintenance', {
    title: 'Maintenance', page: 'maintenance', user: request.user, orders: orders.rows
  });
});

webRouter.get('/provinces', async (request: AuthenticatedRequest, response) => {
  const provinces = await query(
    `SELECT p.*, COUNT(l.id) total,
       COUNT(l.id) FILTER (WHERE l.status = 'ONLINE') online,
       COUNT(l.id) FILTER (WHERE l.status = 'OFFLINE') offline,
       COUNT(l.id) FILTER (WHERE l.status = 'FAULT') fault,
       COALESCE(SUM(l.last_power_w), 0)::numeric(14,2) current_power_w
     FROM provinces p LEFT JOIN lights l ON l.province_id = p.id AND l.status <> 'RETIRED'
     GROUP BY p.id ORDER BY p.name_en`
  );
  response.render('provinces', {
    title: 'Provinces & capital', page: 'provinces', user: request.user, provinces: provinces.rows
  });
});

