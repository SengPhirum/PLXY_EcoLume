<p align="center">
  <img src="brand/ecolume-logo.svg" alt="EcoLume — PLXY smart street lighting" width="320">
</p>

![PLXY EcoLume smart LED street-light network in Cambodia](docs/assets/ecolume-cover.webp)

# PLXY EcoLume

PLXY EcoLume is an open, secure-by-design smart street-light management platform for nationwide public-lighting operations. It combines an ESP32 field controller with a central web platform for live monitoring, remote dimming, fault alerts, and maintenance coordination across Cambodia's 24 provinces and Phnom Penh.

**[Documentation site](https://sengphirum.github.io/PLXY_EcoLume/)** ·
**[Install the firmware from your browser](https://sengphirum.github.io/PLXY_EcoLume/install/)** ·
[Architecture](docs/ARCHITECTURE.md) ·
[Hardware](docs/HARDWARE.md) ·
[API](docs/API.md)

> **Status:** working cellular MVP/reference implementation. Before public-road deployment, complete electrical certification, carrier/RF testing, security review, field calibration, redundancy testing, and ministry acceptance. Never connect an ESP32 directly to mains voltage.

## Communication options

| Option | Recommended use | Pole connection | Recurring cost |
|---|---|---|---|
| **1 — Direct SIM7600 cellular/GNSS** | Isolated poles, rapid pilots, gateway fallback | One SIM per pole | Mobile plan per pole |
| **2 — LoRaWAN + shared gateway backhaul** | Groups of poles along roads, districts, parks, and compounds | ESP32 + SX1262 to nearby gateway | No SIM per pole; one backhaul per gateway |

- [Option 1: illustrated ESP32 + SIM7600 firmware and installation guide](firmware/README.md)
- [Option 2: low-cost LoRaWAN architecture and real-world deployment tutorial](firmware-lorawan/README.md)

Option 2 requires a new LoRaWAN firmware variant and EcoLume adapter; it is documented but not yet implemented in the current MVP. Radio channels, power, antennas, and equipment approval must be confirmed with Cambodia's Telecommunication Regulator before field transmission or production purchasing.

## What is included

- `firmware/` — PlatformIO firmware for ESP32 + SIM7600, GPS, INA219 metering, temperature, PWM/relay control, MQTT telemetry, command handling, offline queue, and watchdog.
- `firmware-lorawan/` — Option 2 architecture, low-cost equipment plan, node/gateway setup, ChirpStack integration, field survey, security, and rollout tutorial.
- `backend/` — TypeScript/Express service with PostgreSQL, authenticated admin portal, device API, MQTT ingestion, alert rules, work orders, audit logs, and health checks.
- `scripts/device-simulator.ts` — simulated street lights for demonstrations and load testing.
- `docker-compose.yml` — PostgreSQL, Mosquitto, backend, and simulator-ready local deployment.
- `docs/` — architecture, [hardware equipment and picture guide](docs/HARDWARE.md), security, deployment, API, and field rollout guidance.
- `docs-site/` — the documentation website and browser-based ESP32 installer, published to GitHub Pages.
- `brand/` — the EcoLume mark, app icons, favicons, and colour tokens shared by the portal and the site.
- `tools/` — development-only generators, including the boundary dataset behind the operations map.

## Core capabilities

| Area | Capability |
|---|---|
| Fleet | Asset registry, province/city grouping, GPS, device and firmware status |
| Operations | Live status, brightness control, desired-vs-actual state, last contact |
| Mapping | Real province boundaries, country or single-zone view, assets plotted from GNSS |
| Telemetry | Voltage, current, power, accumulated energy, temperature, RSSI, GNSS |
| Alerts | Offline, lamp failure, abnormal voltage, over-temperature, tamper |
| Maintenance | Work orders, priority, assignment, status, due date, alert linkage |
| Security | Per-device tokens, hashed credentials, per-device serial provisioning, TLS-ready broker and API, RBAC, audit trail |
| Resilience | Cellular reconnect, local safety schedule, queued telemetry, watchdog |

## Admin operations centre

![PLXY EcoLume national operations dashboard](docs/assets/admin-dashboard.png)

The responsive admin portal provides national fleet availability, live asset locations, electrical status, energy usage, priority alerts, provincial readiness, remote commands, and maintenance workflows. This screenshot was rendered from the actual dashboard code with representative demonstration data—no production credentials or ministry asset locations are included.

The live-fleet map draws real province boundaries and plots each asset from its
reported GNSS position. Operators switch between the whole country and a single
province from the panel, or click a province to focus it; `MAP_REGION` sets the
default view. Boundary data is bundled with the application rather than fetched
from a tile service, so an operations centre without internet access keeps
working and asset positions are never disclosed to an outside host by the act of
drawing them. See [Operations map](docs/ARCHITECTURE.md#operations-map) for the
boundary-data caveats that must be resolved before ministry acceptance.

## Current implemented architecture

```mermaid
flowchart TD
    A["LED luminaire + isolated driver"] --> B["ESP32 field controller"]
    C["SIM7600 LTE + GNSS"] --> B
    B -->|MQTT over TLS| D["MQTT broker"]
    B -->|HTTPS fallback| E["EcoLume API"]
    D --> E
    E --> F["PostgreSQL"]
    E --> G["Operations dashboard"]
    E --> H["Alert & maintenance workflow"]
```

## Quick start

1. Copy the environment template and set strong secrets:

   ```bash
   cp .env.example .env
   ```

2. Start the platform:

   ```bash
   docker compose up --build
   ```

3. Open `http://localhost:8080` and sign in with the strong one-time values configured in `ADMIN_USERNAME` and `ADMIN_INITIAL_PASSWORD`.

4. Simulate devices:

   ```bash
   docker compose --profile simulator up simulator
   ```

Detailed instructions are in [Deployment](docs/DEPLOYMENT.md), [Option 1 firmware](firmware/README.md), and [Option 2 LoRaWAN](firmware-lorawan/README.md).

## Default topics and API

- Telemetry: `ecolume/v1/devices/{deviceId}/telemetry`
- Commands: `ecolume/v1/devices/{deviceId}/commands`
- Events/acknowledgements: `ecolume/v1/devices/{deviceId}/events`
- HTTPS fallback: `POST /api/v1/device/telemetry`
- Health: `GET /health`

See [API and MQTT contract](docs/API.md).

## Development

```bash
cd backend
npm install
npm run typecheck
npm test
npm run dev
```

Firmware:

```bash
cd firmware
cp include/config.example.h include/config.h
pio run                    # build
pio run --target upload    # flash over USB
pio device monitor         # provisioning console at 115200 baud
```

Or install the latest [published release](https://github.com/SengPhirum/PLXY_EcoLume/releases)
straight from [the browser](https://sengphirum.github.io/PLXY_EcoLume/install/) — connect an ESP32 over
USB in Chrome, Edge, or Opera on desktop and click **Install**. A web-installed controller
carries no credentials; give it its identity on the serial console with
`set device.id …`, `set device.token …`, `set apn …`, then `reboot`. See the
[firmware guide](firmware/README.md#provision-over-the-serial-console).

Documentation site:

```bash
npm --prefix docs-site ci
npm --prefix docs-site run serve    # http://localhost:4321
npm --prefix docs-site run verify   # link, asset, and installer-manifest checks
```

## Continuous integration

| Workflow | Trigger | Result |
|---|---|---|
| `backend-ci.yml` | Backend or script changes | Typecheck, tests, and production build |
| `firmware-ci.yml` | Firmware changes | Builds both PlatformIO environments and packages the installer artifacts |
| `firmware-release.yml` | Tag `firmware-v*` | Publishes a versioned release: merged flash image, ESP Web Tools manifest, `SHA256SUMS` |
| `docs.yml` | Docs changes or a published release | Builds the site, bundles the newest stable firmware, deploys to GitHub Pages |

Tag a release with `git tag firmware-v1.0.0 && git push origin firmware-v1.0.0`; the
documentation installer follows the newest stable release automatically. Pre-release tags
(`firmware-v1.1.0-rc1`) are published but not served to installers.

## Safety and privacy

- Do not store production credentials, SIM PINs, LoRaWAN root keys, precise government asset locations, or broker certificates in Git. Published firmware images carry no credentials — controllers are provisioned per device over the serial console.
- TinyGSM's SIM7600 driver has no SSL support, so the reference firmware refuses to publish until an operator explicitly accepts plaintext MQTT. Close that gap before field deployment: see [Security](docs/SECURITY.md#transport-security-on-the-sim7600-build).
- The repository does not include a software license. Copyright remains with the repository owner unless a license is added.
- Follow Cambodia's electrical, telecommunications, cybersecurity, procurement, and personal-data requirements.
- Use certified surge protection, galvanic isolation, weatherproof enclosures, proper earthing, and qualified electrical engineers.

## Roadmap

- Pilot: 20–50 lights in one district, comparing direct cellular and LoRaWAN where practical
- Controlled rollout: two provinces with carrier/RF and maintenance-team validation
- National rollout: regional gateways/brokers, high-availability database, disaster recovery, SIEM integration, and 24/7 NOC/SOC procedures
