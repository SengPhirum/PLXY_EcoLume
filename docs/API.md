# API and MQTT contract

Base path: `/api/v1`. Administrator endpoints use the secure session cookie. The device fallback endpoint uses `X-Device-ID` and `X-Device-Token`.

## Device telemetry

`POST /api/v1/device/telemetry`

```json
{
  "schemaVersion": 1,
  "deviceId": "KH-PNH-000001",
  "sequence": 4172,
  "uptimeSeconds": 86400,
  "firmwareVersion": "0.1.0",
  "relayOn": true,
  "brightness": 80,
  "voltage": 230.4,
  "current": 0.42,
  "power": 96.7,
  "energyWh": 1482.4,
  "temperature": 48.2,
  "ambientLux": 3.4,
  "rssi": 18,
  "tamper": false,
  "gps": {
    "latitude": 11.5482,
    "longitude": 104.9214,
    "accuracyMeters": 8.2
  }
}
```

The same JSON is published to:

`ecolume/v1/devices/{deviceId}/telemetry`

## Commands

`POST /api/v1/lights/{lightId}/commands`

Set state:

```json
{ "action": "set", "on": true, "brightness": 70 }
```

Other actions:

```json
{ "action": "identify" }
```

```json
{ "action": "sampleNow" }
```

```json
{ "action": "restart" }
```

The central service adds a UUID `commandId` and publishes the command to:

`ecolume/v1/devices/{deviceId}/commands`

Device acknowledgement:

```json
{
  "schemaVersion": 1,
  "deviceId": "KH-PNH-000001",
  "event": "commandAck",
  "commandId": "58b9dc99-3344-4f69-b817-935e9bda7f75",
  "success": true,
  "message": "Command applied"
}
```

Acknowledgements publish to `ecolume/v1/devices/{deviceId}/events`.

## Administrator endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/dashboard` | Fleet and alert summary |
| GET | `/api/v1/lights` | Filterable light inventory |
| POST | `/api/v1/lights` | Provision asset and one-time device credential (admin) |
| GET | `/api/v1/lights/{id}` | Asset, telemetry, alerts, commands |
| POST | `/api/v1/lights/{id}/commands` | Remote operation |
| POST | `/api/v1/alerts/{id}/acknowledge` | Acknowledge alert |
| POST | `/api/v1/work-orders` | Create maintenance work |
| PATCH | `/api/v1/work-orders/{id}/status` | Advance work status |

Pagination, API keys for integrations, OpenAPI generation, and export endpoints are planned for the controlled rollout.
