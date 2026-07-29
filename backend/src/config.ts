import 'dotenv/config';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  APP_BASE_URL: z.string().url().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1).default('postgres://ecolume:ecolume@localhost:5432/ecolume'),
  JWT_SECRET: z.string().min(32).default('development-only-secret-change-before-production'),
  ADMIN_USERNAME: z.string().min(3).default('admin'),
  ADMIN_INITIAL_PASSWORD: z.string().min(12).optional(),
  COOKIE_SECURE: booleanString.default(false),
  SEED_DEMO_DATA: booleanString.default(false),
  MQTT_ENABLED: booleanString.default(true),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_TOPIC_PREFIX: z.string().default('ecolume/v1'),
  DEVICE_DEMO_TOKEN: z.string().min(16).optional(),
  OFFLINE_AFTER_MINUTES: z.coerce.number().int().min(2).max(1440).default(15),
  TELEMETRY_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === 'production';

if (isProduction && config.JWT_SECRET.startsWith('development-')) {
  throw new Error('JWT_SECRET must be replaced in production');
}
