import { describe, expect, it } from 'vitest';
import { telemetrySchema } from '../src/services/telemetry.js';

describe('telemetry contract', () => {
  it('rejects coordinates outside Cambodia operating bounds', () => {
    const result = telemetrySchema.safeParse({
      schemaVersion: 1,
      deviceId: 'KH-PNH-000001',
      sequence: 10,
      uptimeSeconds: 100,
      relayOn: true,
      brightness: 75,
      voltage: 230,
      current: 0.4,
      power: 92,
      energyWh: 200,
      gps: { latitude: 40.7, longitude: -74 }
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid field sample', () => {
    const result = telemetrySchema.safeParse({
      schemaVersion: 1,
      deviceId: 'KH-SRP-000042',
      sequence: 10,
      uptimeSeconds: 100,
      relayOn: true,
      brightness: 75,
      voltage: 230,
      current: 0.4,
      power: 92,
      energyWh: 200,
      gps: { latitude: 13.36, longitude: 103.85, accuracyMeters: 12 }
    });
    expect(result.success).toBe(true);
  });
});

