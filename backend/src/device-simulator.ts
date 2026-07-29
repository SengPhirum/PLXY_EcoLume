import mqtt from 'mqtt';

const mqttUrl = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const topicPrefix = process.env.MQTT_TOPIC_PREFIX ?? 'ecolume/v1';
const requestedCount = Number(process.env.SIMULATOR_DEVICES ?? 6);
const sampleIntervalMs = Number(process.env.SIMULATOR_INTERVAL_MS ?? 10_000);

const assets = [
  { id: 'KH-PNH-000001', lat: 11.5482, lon: 104.9214 },
  { id: 'KH-PNH-000002', lat: 11.5731, lon: 104.8891 },
  { id: 'KH-SRP-000001', lat: 13.3671, lon: 103.8448 },
  { id: 'KH-BTB-000001', lat: 13.0957, lon: 103.2022 },
  { id: 'KH-SHV-000001', lat: 10.6253, lon: 103.5234 },
  { id: 'KH-KPC-000001', lat: 11.9934, lon: 105.4635 }
].slice(0, Math.min(requestedCount, 6));

const sequences = new Map<string, number>();
const startedAt = Date.now();
const client = mqtt.connect(mqttUrl, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: `ecolume-simulator-${process.pid}`
});

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function publishSamples(): void {
  assets.forEach((asset, index) => {
    const sequence = (sequences.get(asset.id) ?? 0) + 1;
    sequences.set(asset.id, sequence);
    const faultCycle = sequence % 40 === 0 && index === 2;
    const payload = {
      schemaVersion: 1,
      deviceId: asset.id,
      sequence,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      firmwareVersion: '0.1.0-sim',
      relayOn: true,
      brightness: 80,
      voltage: Number(random(224, 236).toFixed(2)),
      current: Number(random(0.38, 0.46).toFixed(3)),
      power: faultCycle ? 3.2 : Number(random(90, 104).toFixed(2)),
      energyWh: Number((sequence * random(14, 17)).toFixed(2)),
      temperature: Number(random(39, 56).toFixed(1)),
      ambientLux: Number(random(1, 12).toFixed(1)),
      rssi: Math.round(random(13, 26)),
      tamper: false,
      gps: {
        latitude: asset.lat + random(-0.00002, 0.00002),
        longitude: asset.lon + random(-0.00002, 0.00002),
        accuracyMeters: Number(random(3, 11).toFixed(1))
      }
    };
    client.publish(
      `${topicPrefix}/devices/${asset.id}/telemetry`,
      JSON.stringify(payload),
      { qos: 1 }
    );
  });
}

client.on('connect', () => {
  console.log(`EcoLume simulator connected; publishing ${assets.length} devices`);
  client.subscribe(`${topicPrefix}/devices/+/commands`, { qos: 1 });
  publishSamples();
  setInterval(publishSamples, sampleIntervalMs);
});

client.on('message', (topic, payload) => {
  const deviceId = topic.split('/').at(-2);
  if (!deviceId || !assets.some((asset) => asset.id === deviceId)) return;
  try {
    const command = JSON.parse(payload.toString()) as { commandId?: string; action?: string };
    client.publish(
      `${topicPrefix}/devices/${deviceId}/events`,
      JSON.stringify({
        schemaVersion: 1,
        deviceId,
        event: 'commandAck',
        commandId: command.commandId,
        success: true,
        message: `Simulator applied ${command.action}`
      }),
      { qos: 1 }
    );
  } catch (error) {
    console.error('Invalid simulator command', error);
  }
});

client.on('error', (error) => console.error('Simulator MQTT error', error.message));

