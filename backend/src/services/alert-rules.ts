import type { AlertCandidate, TelemetryInput } from '../types.js';

export function evaluateTelemetry(
  telemetry: TelemetryInput,
  nominalWatts: number
): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];

  if (telemetry.relayOn && telemetry.brightness >= 20 && telemetry.power < nominalWatts * 0.15) {
    alerts.push({
      type: 'LAMP_FAILURE',
      severity: 'CRITICAL',
      message: `Lamp is commanded on but power is only ${telemetry.power.toFixed(1)} W`
    });
  }
  if (telemetry.voltage > 265) {
    alerts.push({
      type: 'OVERVOLTAGE',
      severity: 'CRITICAL',
      message: `Supply voltage is high at ${telemetry.voltage.toFixed(1)} V`
    });
  } else if (telemetry.voltage < 180) {
    alerts.push({
      type: 'UNDERVOLTAGE',
      severity: 'WARNING',
      message: `Supply voltage is low at ${telemetry.voltage.toFixed(1)} V`
    });
  }
  if (telemetry.temperature !== undefined && telemetry.temperature > 85) {
    alerts.push({
      type: 'OVER_TEMPERATURE',
      severity: 'CRITICAL',
      message: `Controller temperature is ${telemetry.temperature.toFixed(1)} °C`
    });
  } else if (telemetry.temperature !== undefined && telemetry.temperature > 70) {
    alerts.push({
      type: 'HIGH_TEMPERATURE',
      severity: 'WARNING',
      message: `Controller temperature is ${telemetry.temperature.toFixed(1)} °C`
    });
  }
  if (telemetry.tamper) {
    alerts.push({
      type: 'CABINET_TAMPER',
      severity: 'CRITICAL',
      message: 'Street-light cabinet tamper input is active'
    });
  }
  if (telemetry.rssi !== undefined && telemetry.rssi > 0 && telemetry.rssi < 8) {
    alerts.push({
      type: 'WEAK_SIGNAL',
      severity: 'WARNING',
      message: `Cellular signal quality is weak (${telemetry.rssi}/31)`
    });
  }

  return alerts;
}

