import type { Request } from 'express';

export type UserRole = 'ADMIN' | 'OPERATOR' | 'MAINTENANCE' | 'VIEWER';

export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
}

export interface TelemetryInput {
  schemaVersion: 1;
  deviceId: string;
  sequence: number;
  uptimeSeconds: number;
  firmwareVersion?: string;
  relayOn: boolean;
  brightness: number;
  voltage: number;
  current: number;
  power: number;
  energyWh: number;
  temperature?: number;
  ambientLux?: number;
  rssi?: number;
  tamper?: boolean;
  gps?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
  };
}

export interface AlertCandidate {
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
}

