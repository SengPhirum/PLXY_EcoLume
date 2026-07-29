import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { closeDatabase, initializeDatabase, query } from './db.js';
import { startMqtt, stopMqtt } from './mqtt.js';
import { seedDatabase } from './seed.js';
import { markOfflineLights } from './services/telemetry.js';

async function start(): Promise<void> {
  await initializeDatabase();
  await seedDatabase();
  startMqtt();

  const app = createApp();
  const server = createServer(app);
  server.listen(config.PORT, '0.0.0.0', () => {
    console.log(`PLXY EcoLume listening on ${config.PORT}`);
  });

  const monitoringTimer = setInterval(async () => {
    try {
      const count = await markOfflineLights(config.OFFLINE_AFTER_MINUTES);
      if (count > 0) console.warn(`Marked ${count} light(s) offline`);

      await query(
        `DELETE FROM telemetry WHERE recorded_at < NOW() - ($1 * INTERVAL '1 day')`,
        [config.TELEMETRY_RETENTION_DAYS]
      );
    } catch (error) {
      console.error('Monitoring task failed', error);
    }
  }, 60_000);
  monitoringTimer.unref();

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; shutting down`);
    clearInterval(monitoringTimer);
    server.close(async () => {
      await stopMqtt();
      await closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((error) => {
  console.error('EcoLume failed to start', error);
  process.exit(1);
});

