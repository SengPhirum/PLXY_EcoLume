# Deployment guide

## Local demonstration

Requirements: Docker Engine 26+, Docker Compose v2, 4 GB free RAM.

```bash
cp .env.example .env
```

Set at minimum:

- `POSTGRES_PASSWORD`
- `JWT_SECRET` generated from at least 32 random bytes
- `ADMIN_INITIAL_PASSWORD`
- `DEVICE_DEMO_TOKEN`

Ensure the password in `DATABASE_URL` matches `POSTGRES_PASSWORD`, then run:

```bash
docker compose up --build
docker compose --profile simulator up simulator
```

Open `http://localhost:8080`.

## Production minimum

Do not expose the development Compose configuration to the internet. Use:

- reverse proxy/load balancer with HTTPS;
- private PostgreSQL network and HA/backup policy;
- clustered TLS MQTT broker with per-device ACLs;
- secret manager;
- SSO/MFA and role mapping;
- centralized monitoring, logs, SIEM, vulnerability scanning, and EDR;
- multiple application replicas;
- carrier private APN/VPN where feasible;
- staging environment and signed release process.

## Initial provisioning

1. Create an asset code and location record.
2. Generate a cryptographically random device credential.
3. Store only its keyed hash in `device_credentials`.
4. Program the unique identifier, credential, APN, broker, and CA in a controlled facility.
5. Bind the modem/PCB/driver/pole serial numbers to the asset record.
6. Verify the first telemetry and perform installation acceptance.

The MVP seeds demonstration assets only when `SEED_DEMO_DATA=true`. Production must set it to `false`.

## Documentation site and firmware releases

The documentation site in `docs-site/` is a static build published to GitHub Pages by
`.github/workflows/docs.yml`. One-time setup: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. After that the workflow runs on documentation changes, whenever a
release is published, and on demand.

Build and preview it locally:

```bash
npm --prefix docs-site ci
npm --prefix docs-site run serve    # http://localhost:4321
npm --prefix docs-site run verify   # link, asset, and manifest checks
```

Publish a firmware release, which is what the browser installer serves:

```bash
git tag firmware-v1.0.0
git push origin firmware-v1.0.0
```

`.github/workflows/firmware-release.yml` builds the `esp32-sim7600-release` environment,
merges bootloader, partition table, OTA selector, and application into a single image,
writes the ESP Web Tools manifest and `SHA256SUMS`, and publishes them as release assets. A
tag containing a hyphen (`firmware-v1.1.0-rc1`) is published as a pre-release and is *not*
picked up by the installer, which only tracks the newest stable release.

Publishing the release triggers the documentation workflow, so the installer page starts
serving the new build without any manual step. `workflow_dispatch` on either workflow lets
you rebuild on demand.

## Backups

At minimum:

- nightly encrypted database backup;
- continuous WAL archiving for point-in-time recovery;
- copy in a separate failure domain;
- quarterly restore exercise;
- documented RPO/RTO and named recovery owner.

Telemetry retention defaults to 365 days. National scale should aggregate old telemetry and archive it outside the primary database.

## Upgrade order

1. Deploy database-compatible migrations.
2. Deploy backend instances.
3. Verify health, MQTT ingestion, commands, and alert processing.
4. Roll out signed device firmware in a small canary group.
5. Expand only after the observation window and rollback check.

## Pilot acceptance

- telemetry delivery ≥99% under defined carrier coverage;
- command acknowledgement and expiry verified;
- fault detection sensitivity and false-positive target agreed;
- electrical measurements calibrated;
- maintenance ticket workflow completed end-to-end;
- 72-hour communications failure and recovery passed;
- disaster recovery and security incident tabletop completed.

