#pragma once

// Copy to config.h and provision every device with unique credentials.
#define DEVICE_ID "KH-PP-000001"
#define DEVICE_TOKEN "replace-with-unique-random-device-token"

#define CELLULAR_APN "your-carrier-apn"
#define CELLULAR_USER ""
#define CELLULAR_PASSWORD ""
#define CELLULAR_PIN ""

#define MQTT_HOST "mqtt.example.gov.kh"
#define MQTT_PORT 8883
#define MQTT_USERNAME DEVICE_ID
#define MQTT_PASSWORD DEVICE_TOKEN
#define MQTT_TOPIC_PREFIX "ecolume/v1"

// Replace with the issuing CA certificate for the production broker.
static const char MQTT_ROOT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_PRODUCTION_CA_CERTIFICATE
-----END CERTIFICATE-----
)EOF";

// Hardware pins must be validated against the selected PCB.
constexpr int MODEM_RX_PIN = 26;
constexpr int MODEM_TX_PIN = 27;
constexpr int MODEM_PWRKEY_PIN = 4;
constexpr int MODEM_POWER_ON_PIN = 25;
constexpr int LED_RELAY_PIN = 18;
constexpr int LED_DIM_PIN = 19;
constexpr int CABINET_TAMPER_PIN = 23;
constexpr int TEMPERATURE_PIN = 34;
constexpr int STATUS_LED_PIN = 2;

constexpr float NOMINAL_LAMP_WATTS = 120.0F;
constexpr uint32_t TELEMETRY_INTERVAL_MS = 60000;
constexpr uint32_t COMMAND_WATCHDOG_MS = 15 * 60000;
constexpr uint8_t SAFE_NIGHT_BRIGHTNESS = 70;
constexpr uint8_t FAILSAFE_BRIGHTNESS = 100;

