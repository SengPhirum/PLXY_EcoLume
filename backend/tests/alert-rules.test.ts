import { describe, expect, it } from 'vitest';
import { evaluateTelemetry } from '../src/services/alert-rules.js';
import type { TelemetryInput } from '../src/types.js';

const normal: TelemetryInput = {
  schemaVersion: 1,
  deviceId: 'KH-PNH-000001',
  sequence: 1,
  uptimeSeconds: 100,
  relayOn: true,
  brightness: 80,
  voltage: 230,
  current: 0.42,
  power: 96,
  energyWh: 500,
  temperature: 46,
  rssi: 19,
  tamper: false
};

describe('telemetry alert rules', () => {
  it('accepts normal light telemetry without alerts', () => {
    expect(evaluateTelemetry(normal, 120)).toEqual([]);
  });

  it('detects an energized lamp with no useful power draw', () => {
    const alerts = evaluateTelemetry({ ...normal, power: 4 }, 120);
    expect(alerts).toContainEqual(expect.objectContaining({
      type: 'LAMP_FAILURE',
      severity: 'CRITICAL'
    }));
  });

  it('detects dangerous temperature, voltage, and tamper conditions', () => {
    const alerts = evaluateTelemetry({
      ...normal,
      voltage: 271,
      temperature: 91,
      tamper: true
    }, 120);
    expect(alerts.map((alert) => alert.type)).toEqual(
      expect.arrayContaining(['OVERVOLTAGE', 'OVER_TEMPERATURE', 'CABINET_TAMPER'])
    );
  });
});

