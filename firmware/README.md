# EcoLume field agent

Reference firmware for an ESP32 development board connected to a SIM7600 LTE/GNSS modem, an isolated LED driver interface, INA219 DC-side metering, NTC temperature sensor, ambient-light sensor, and cabinet tamper input.

## Important electrical boundary

The ESP32, SIM7600, and INA219 are low-voltage components. They must **never** be connected directly to 220–240 V AC or to an LED driver's high-voltage output. A production controller requires:

- certified isolated AC/DC supply;
- surge protection suitable for outdoor lighting;
- opto-isolated relay/contactor or certified DALI/0–10 V driver interface;
- correctly rated metering front end;
- earthing, fusing, lightning protection, IP65+ enclosure, and thermal design;
- review and installation by qualified electrical engineers.

## Reference pinout

| Signal | ESP32 pin | Notes |
|---|---:|---|
| SIM7600 RX/TX | 26/27 | Use correct logic levels and dedicated modem supply |
| Modem PWRKEY | 4 | Board-specific timing may differ |
| Modem power enable | 25 | Drive through the board's supported control |
| Isolated relay | 18 | Logic signal only |
| Isolated dimming PWM | 19 | Convert to certified driver interface |
| Tamper input | 23 | Normally closed recommended |
| NTC analog | 34 | Calibrate divider |
| I²C metering/lux | 21/22 | INA219 and BH1750 |

## Build

1. Install [PlatformIO](https://platformio.org/).
2. Copy `include/config.example.h` to `include/config.h`.
3. Set the APN, unique device credentials, broker hostname, and CA certificate.
4. Compile with `pio run`; flash with `pio run --target upload`.

## Provisioning

Each controller must have:

- a unique immutable `DEVICE_ID`;
- a unique random device token (minimum 32 bytes);
- a broker ACL limited to its telemetry/events publish topics and its own command subscription;
- the production CA certificate;
- an asset record created in EcoLume before field installation.

Do not reuse the demonstration token from the simulator.

## Field validation checklist

- Validate modem startup current and brownout behavior.
- Test the selected Cambodian carrier/APN at the installation location.
- Calibrate voltage, current, power, temperature, and GNSS accuracy.
- Confirm relay fail-safe state and local night-light schedule.
- Test 72-hour network loss, power cycling, broker outage, and queued telemetry.
- Measure enclosure temperature and RF performance.
- Complete secure boot, flash encryption, signed OTA, and rollback before production.

