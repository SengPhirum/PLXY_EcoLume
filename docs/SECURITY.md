# Security baseline

Street lighting is critical public infrastructure. Production deployment requires a formal threat model, penetration test, secure-development lifecycle, incident response, vulnerability management, and supply-chain assurance.

## Device

- Unique credential per controller; never use one fleet-wide password.
- MQTT ACL: device may publish only its telemetry/events topics and subscribe only to its command topic.
- TLS 1.2 or later with certificate validation; mutual TLS is preferred.
- ESP32 secure boot, flash encryption, disabled debug ports, signed A/B OTA, anti-rollback, and protected keys.
- Local fail-safe behavior must preserve safe lighting during communication loss.
- Commands must gain expiry, monotonic counters, and signed payloads before production.
- Rate-limit restart/dimming commands and reject stale or duplicated commands.

## Central platform

- Place the API and broker behind managed firewall/WAF and network segmentation.
- Terminate TLS using organization-approved certificates and strong ciphers.
- Integrate administrator authentication with government identity/SSO and MFA.
- Apply least-privilege RBAC: administrator, operator, maintenance, and viewer.
- Centralize immutable audit logs and forward security events to SIEM.
- Encrypt backups and data volumes; test restore and disaster recovery.
- Rotate secrets in a secret manager, not `.env` files, in production.
- Restrict exact asset coordinates to authorized operational roles.

## MQTT production changes

The included `mosquitto.conf` allows anonymous local development traffic and must not be exposed publicly. Production should use:

```conf
listener 8883
protocol mqtt
allow_anonymous false
password_file /mosquitto/secrets/passwords
acl_file /mosquitto/secrets/acl
cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key
tls_version tlsv1.2
```

Example per-device ACL:

```text
user KH-PNH-000001
topic write ecolume/v1/devices/KH-PNH-000001/telemetry
topic write ecolume/v1/devices/KH-PNH-000001/events
topic read ecolume/v1/devices/KH-PNH-000001/commands
```

Use an automated provisioning service; do not manually maintain national-scale password files.

## Public repository warning

This repository was created public. Do not commit:

- exact non-public pole locations or infrastructure diagrams;
- APN credentials, SIM identifiers, tokens, passwords, private keys, or certificates;
- production IP addresses, hostnames, VPN design, or firewall rules;
- ministry personnel data, incident evidence, or vendor-confidential documents.

If the implementation will contain such data, change the repository to private and still use a secret manager.

## Reporting vulnerabilities

Do not disclose critical-infrastructure vulnerabilities in a public issue. Establish a private security contact and coordinated disclosure procedure before pilot deployment.

