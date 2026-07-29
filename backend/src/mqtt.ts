import mqtt, { type MqttClient } from 'mqtt';
import { config } from './config.js';
import { acknowledgeCommand, ingestTelemetry } from './services/telemetry.js';

let client: MqttClient | undefined;

export function startMqtt(): MqttClient | undefined {
  if (!config.MQTT_ENABLED) return undefined;

  client = mqtt.connect(config.MQTT_URL, {
    username: config.MQTT_USERNAME,
    password: config.MQTT_PASSWORD,
    reconnectPeriod: 5_000,
    connectTimeout: 20_000,
    clean: true,
    clientId: `ecolume-backend-${process.pid}`
  });

  client.on('connect', () => {
    console.log('Connected to MQTT broker');
    client?.subscribe(
      [
        `${config.MQTT_TOPIC_PREFIX}/devices/+/telemetry`,
        `${config.MQTT_TOPIC_PREFIX}/devices/+/events`
      ],
      { qos: 1 }
    );
  });

  client.on('message', async (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString()) as Record<string, unknown>;
      if (topic.endsWith('/telemetry')) {
        await ingestTelemetry(data as never);
      } else if (topic.endsWith('/events') && data.event === 'commandAck') {
        await acknowledgeCommand(
          String(data.commandId ?? ''),
          Boolean(data.success),
          String(data.message ?? '')
        );
      }
    } catch (error) {
      console.error('MQTT message rejected', { topic, error });
    }
  });

  client.on('error', (error) => console.error('MQTT error', error.message));
  return client;
}

export function publishCommand(deviceId: string, command: object): boolean {
  if (!client?.connected) return false;
  try {
    client.publish(
      `${config.MQTT_TOPIC_PREFIX}/devices/${deviceId}/commands`,
      JSON.stringify(command),
      { qos: 1, retain: false }
    );
    return true;
  } catch {
    return false;
  }
}

export async function stopMqtt(): Promise<void> {
  if (!client) return;
  await new Promise<void>((resolve, reject) => client?.end(false, {}, (error) => {
    if (error) reject(error);
    else resolve();
  }));
  client = undefined;
}
