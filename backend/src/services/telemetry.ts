import { z } from 'zod';
import { query, transaction } from '../db.js';
import type { TelemetryInput } from '../types.js';
import { evaluateTelemetry } from './alert-rules.js';

export const telemetrySchema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string().min(3).max(80).regex(/^[A-Za-z0-9_-]+$/),
  sequence: z.number().int().nonnegative(),
  uptimeSeconds: z.number().int().nonnegative(),
  firmwareVersion: z.string().max(40).optional(),
  relayOn: z.boolean(),
  brightness: z.number().int().min(0).max(100),
  voltage: z.number().min(0).max(400),
  current: z.number().min(0).max(100),
  power: z.number().min(0).max(20_000),
  energyWh: z.number().min(0).max(1_000_000_000),
  temperature: z.number().min(-40).max(150).optional(),
  ambientLux: z.number().min(0).max(500_000).optional(),
  rssi: z.number().int().min(-127).max(99).optional(),
  tamper: z.boolean().optional(),
  gps: z.object({
    latitude: z.number().min(9.5).max(15.0),
    longitude: z.number().min(102.0).max(108.0),
    accuracyMeters: z.number().min(0).max(10_000).optional()
  }).optional()
});

interface LightRow {
  id: string;
  nominal_watts: string;
}

export async function ingestTelemetry(input: TelemetryInput): Promise<{ lightId: string; duplicate: boolean }> {
  const telemetry = telemetrySchema.parse(input);

  return transaction(async (client) => {
    const lightResult = await client.query<LightRow>(
      `SELECT id, nominal_watts FROM lights WHERE asset_code = $1 AND status <> 'RETIRED' FOR UPDATE`,
      [telemetry.deviceId]
    );
    const light = lightResult.rows[0];
    if (!light) throw new Error('UNKNOWN_DEVICE');

    const inserted = await client.query(
      `INSERT INTO telemetry(
         light_id, sequence, uptime_seconds, voltage_v, current_a, power_w, energy_wh,
         temperature_c, ambient_lux, brightness, relay_on, rssi, tamper,
         latitude, longitude, gps_accuracy_m, raw_payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
       ) ON CONFLICT (light_id, sequence) DO NOTHING
       RETURNING id`,
      [
        light.id, telemetry.sequence, telemetry.uptimeSeconds, telemetry.voltage,
        telemetry.current, telemetry.power, telemetry.energyWh, telemetry.temperature ?? null,
        telemetry.ambientLux ?? null, telemetry.brightness, telemetry.relayOn,
        telemetry.rssi ?? null, telemetry.tamper ?? false, telemetry.gps?.latitude ?? null,
        telemetry.gps?.longitude ?? null, telemetry.gps?.accuracyMeters ?? null,
        JSON.stringify(telemetry)
      ]
    );

    if (inserted.rowCount === 0) return { lightId: light.id, duplicate: true };

    await client.query(
      `UPDATE lights SET
         status = 'ONLINE', actual_on = $2, actual_brightness = $3,
         firmware_version = COALESCE($4, firmware_version), last_seen_at = NOW(),
         last_power_w = $5, last_voltage_v = $6, last_temperature_c = $7,
         latitude = COALESCE($8, latitude), longitude = COALESCE($9, longitude),
         updated_at = NOW()
       WHERE id = $1`,
      [
        light.id, telemetry.relayOn, telemetry.brightness, telemetry.firmwareVersion ?? null,
        telemetry.power, telemetry.voltage, telemetry.temperature ?? null,
        telemetry.gps?.latitude ?? null, telemetry.gps?.longitude ?? null
      ]
    );

    const candidates = evaluateTelemetry(telemetry, Number(light.nominal_watts));
    for (const alert of candidates) {
      await client.query(
        `INSERT INTO alerts(light_id, type, severity, message)
         SELECT $1, $2, $3, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM alerts
           WHERE light_id = $1 AND type = $2 AND status IN ('OPEN', 'ACKNOWLEDGED')
         )`,
        [light.id, alert.type, alert.severity, alert.message]
      );
    }

    const activeTypes = candidates.map((candidate) => candidate.type);
    const monitoredTypes = [
      'LAMP_FAILURE', 'OVERVOLTAGE', 'UNDERVOLTAGE', 'OVER_TEMPERATURE',
      'HIGH_TEMPERATURE', 'CABINET_TAMPER', 'WEAK_SIGNAL'
    ];
    await client.query(
      `UPDATE alerts SET status = 'RESOLVED', resolved_at = NOW(),
         resolution_note = 'Automatically resolved by normal telemetry'
       WHERE light_id = $1 AND status IN ('OPEN', 'ACKNOWLEDGED')
         AND type = ANY($2::varchar[])
         AND NOT (type = ANY($3::varchar[]))`,
      [light.id, monitoredTypes, activeTypes]
    );

    return { lightId: light.id, duplicate: false };
  });
}

export async function markOfflineLights(offlineMinutes: number): Promise<number> {
  const result = await query<{ id: string }>(
    `UPDATE lights SET status = 'OFFLINE', updated_at = NOW()
     WHERE status IN ('ONLINE', 'FAULT')
       AND last_seen_at < NOW() - ($1 * INTERVAL '1 minute')
     RETURNING id`,
    [offlineMinutes]
  );

  for (const light of result.rows) {
    await query(
      `INSERT INTO alerts(light_id, type, severity, message)
       SELECT $1, 'DEVICE_OFFLINE', 'CRITICAL', 'No telemetry received within the configured threshold'
       WHERE NOT EXISTS (
         SELECT 1 FROM alerts
         WHERE light_id = $1 AND type = 'DEVICE_OFFLINE' AND status IN ('OPEN', 'ACKNOWLEDGED')
       )`,
      [light.id]
    );
  }
  return result.rowCount ?? 0;
}

export async function acknowledgeCommand(
  commandId: string,
  success: boolean,
  message: string
): Promise<void> {
  await query(
    `UPDATE commands SET status = $2, acknowledged_at = NOW(), result_message = $3
     WHERE id = $1`,
    [commandId, success ? 'ACKNOWLEDGED' : 'FAILED', message]
  );
}
