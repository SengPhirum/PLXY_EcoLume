CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS provinces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(8) UNIQUE NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  name_km VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(80) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'MAINTENANCE', 'VIEWER')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS lights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code VARCHAR(80) UNIQUE NOT NULL,
  name VARCHAR(180) NOT NULL,
  province_id UUID NOT NULL REFERENCES provinces(id),
  district VARCHAR(120),
  road VARCHAR(180),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  nominal_watts NUMERIC(10,2) NOT NULL DEFAULT 120,
  status VARCHAR(20) NOT NULL DEFAULT 'PROVISIONING'
    CHECK (status IN ('ONLINE', 'OFFLINE', 'FAULT', 'MAINTENANCE', 'PROVISIONING', 'RETIRED')),
  desired_on BOOLEAN NOT NULL DEFAULT TRUE,
  desired_brightness SMALLINT NOT NULL DEFAULT 100 CHECK (desired_brightness BETWEEN 0 AND 100),
  actual_on BOOLEAN,
  actual_brightness SMALLINT CHECK (actual_brightness BETWEEN 0 AND 100),
  firmware_version VARCHAR(40),
  last_seen_at TIMESTAMPTZ,
  last_power_w NUMERIC(12,3),
  last_voltage_v NUMERIC(12,3),
  last_temperature_c NUMERIC(8,3),
  installed_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_credentials (
  light_id UUID PRIMARY KEY REFERENCES lights(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telemetry (
  id BIGSERIAL PRIMARY KEY,
  light_id UUID NOT NULL REFERENCES lights(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uptime_seconds BIGINT,
  voltage_v NUMERIC(12,3),
  current_a NUMERIC(12,4),
  power_w NUMERIC(12,3),
  energy_wh NUMERIC(16,3),
  temperature_c NUMERIC(8,3),
  ambient_lux NUMERIC(12,2),
  brightness SMALLINT,
  relay_on BOOLEAN,
  rssi SMALLINT,
  tamper BOOLEAN,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  gps_accuracy_m NUMERIC(10,2),
  raw_payload JSONB NOT NULL,
  UNIQUE (light_id, sequence)
);

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  light_id UUID NOT NULL REFERENCES lights(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT
);

CREATE TABLE IF NOT EXISTS work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(30) UNIQUE NOT NULL,
  light_id UUID NOT NULL REFERENCES lights(id),
  alert_id UUID REFERENCES alerts(id),
  title VARCHAR(180) NOT NULL,
  description TEXT,
  priority VARCHAR(20) NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY')),
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  assigned_to VARCHAR(120),
  due_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  light_id UUID NOT NULL REFERENCES lights(id) ON DELETE CASCADE,
  action VARCHAR(40) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'PUBLISHED', 'ACKNOWLEDGED', 'FAILED', 'EXPIRED')),
  issued_by UUID REFERENCES users(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  result_message TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id),
  actor_device_id UUID REFERENCES lights(id),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(60),
  target_id VARCHAR(100),
  detail JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lights_province_status ON lights(province_id, status);
CREATE INDEX IF NOT EXISTS idx_lights_last_seen ON lights(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_light_time ON telemetry(light_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_time ON telemetry(recorded_at);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(status, severity, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_light_time ON commands(light_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

