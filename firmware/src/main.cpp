#include <Arduino.h>
#include <ArduinoJson.h>
#include <Adafruit_INA219.h>
#include <BH1750.h>
#include <PubSubClient.h>
#include <TinyGsmClient.h>
#include <Wire.h>
#include <esp_task_wdt.h>
#include "config.h"
#include "provisioning.h"

HardwareSerial SerialAT(1);
TinyGsm modem(SerialAT);

// TinyGSM only exposes a secure client for modems whose driver implements the
// module's SSL stack. Its SIM7600 driver does not, so this build falls back to
// plaintext TCP and refuses to connect until an operator explicitly accepts
// that with `set mqtt.insecure true` on the provisioning console.
#if defined(TINY_GSM_MODEM_HAS_SSL)
TinyGsmClientSecure networkClient(modem);
constexpr bool TRANSPORT_IS_TLS = true;
#else
TinyGsmClient networkClient(modem);
constexpr bool TRANSPORT_IS_TLS = false;
#endif

PubSubClient mqtt(networkClient);
Adafruit_INA219 powerMeter;
BH1750 ambientSensor;

struct TelemetrySample {
  float voltage = 0;
  float current = 0;
  float power = 0;
  float energyWh = 0;
  float temperature = 0;
  float ambientLux = 0;
  float latitude = 0;
  float longitude = 0;
  float gpsAccuracy = 0;
  int16_t rssi = -127;
  bool gpsValid = false;
  bool relayOn = true;
  bool tamper = false;
  uint8_t brightness = SAFE_NIGHT_BRIGHTNESS;
};

constexpr size_t OFFLINE_QUEUE_SIZE = 24;
constexpr uint32_t NETWORK_WAIT_MS = 30000;
constexpr uint32_t CONNECT_BACKOFF_MIN_MS = 5000;
constexpr uint32_t CONNECT_BACKOFF_MAX_MS = 300000;
constexpr uint32_t GUIDANCE_INTERVAL_MS = 60000;
// The connect path restarts the modem and waits for the network, so the task
// watchdog has to allow for more than NETWORK_WAIT_MS in one loop iteration.
constexpr int WATCHDOG_TIMEOUT_S = 90;

String offlineQueue[OFFLINE_QUEUE_SIZE];
size_t queueHead = 0;
size_t queueCount = 0;
TelemetrySample currentState;
uint32_t lastTelemetryAt = 0;
uint32_t lastEnergyAt = 0;
uint32_t lastCommandAt = 0;
uint32_t nextConnectAttemptAt = 0;
uint32_t connectBackoffMs = CONNECT_BACKOFF_MIN_MS;
uint32_t lastGuidanceAt = 0;

const DeviceSettings &config() {
  return provisioning::settings();
}

// True when the controller is allowed to put telemetry on the wire.
bool transportPermitted() {
  return TRANSPORT_IS_TLS || config().allowInsecure;
}

String telemetryTopic() {
  return config().topicPrefix + "/devices/" + config().deviceId + "/telemetry";
}

String commandTopic() {
  return config().topicPrefix + "/devices/" + config().deviceId + "/commands";
}

String eventTopic() {
  return config().topicPrefix + "/devices/" + config().deviceId + "/events";
}

void setLamp(bool on, uint8_t brightness) {
  currentState.relayOn = on;
  currentState.brightness = constrain(brightness, 0, 100);
  digitalWrite(LED_RELAY_PIN, on ? HIGH : LOW);
  const uint32_t duty = on ? map(currentState.brightness, 0, 100, 0, 255) : 0;
  ledcWrite(0, duty);
}

float readTemperatureC() {
  const int raw = analogRead(TEMPERATURE_PIN);
  if (raw <= 0 || raw >= 4095) return NAN;
  // Reference conversion for a 10k NTC divider. Calibrate for the production PCB.
  const float resistance = 10000.0F * raw / (4095.0F - raw);
  const float steinhart = log(resistance / 10000.0F) / 3950.0F +
                          1.0F / (25.0F + 273.15F);
  return 1.0F / steinhart - 273.15F;
}

void sampleSensors() {
  currentState.voltage = powerMeter.getBusVoltage_V();
  currentState.current = max(0.0F, powerMeter.getCurrent_mA() / 1000.0F);
  currentState.power = max(0.0F, powerMeter.getPower_mW() / 1000.0F);
  currentState.temperature = readTemperatureC();
  currentState.ambientLux = ambientSensor.readLightLevel();
  currentState.tamper = digitalRead(CABINET_TAMPER_PIN) == LOW;
  currentState.rssi = modem.getSignalQuality();

  const uint32_t now = millis();
  if (lastEnergyAt != 0) {
    currentState.energyWh += currentState.power * (now - lastEnergyAt) / 3600000.0F;
  }
  lastEnergyAt = now;

  float lat = 0, lon = 0, speed = 0, altitude = 0, accuracy = 0;
  int visible = 0, used = 0;
  currentState.gpsValid = modem.getGPS(&lat, &lon, &speed, &altitude, &visible, &used, &accuracy);
  if (currentState.gpsValid) {
    currentState.latitude = lat;
    currentState.longitude = lon;
    currentState.gpsAccuracy = accuracy;
  }
}

String serializeTelemetry() {
  JsonDocument doc;
  doc["schemaVersion"] = 1;
  doc["deviceId"] = config().deviceId;
  doc["sequence"] = esp_random();
  doc["uptimeSeconds"] = millis() / 1000;
  doc["firmwareVersion"] = ECOLUME_FIRMWARE_VERSION;
  doc["relayOn"] = currentState.relayOn;
  doc["brightness"] = currentState.brightness;
  doc["voltage"] = serialized(String(currentState.voltage, 2));
  doc["current"] = serialized(String(currentState.current, 3));
  doc["power"] = serialized(String(currentState.power, 2));
  doc["energyWh"] = serialized(String(currentState.energyWh, 2));
  if (!isnan(currentState.temperature)) {
    doc["temperature"] = serialized(String(currentState.temperature, 1));
  }
  doc["ambientLux"] = serialized(String(currentState.ambientLux, 1));
  doc["rssi"] = currentState.rssi;
  doc["tamper"] = currentState.tamper;
  if (currentState.gpsValid) {
    doc["gps"]["latitude"] = serialized(String(currentState.latitude, 6));
    doc["gps"]["longitude"] = serialized(String(currentState.longitude, 6));
    doc["gps"]["accuracyMeters"] = serialized(String(currentState.gpsAccuracy, 1));
  }

  String payload;
  serializeJson(doc, payload);
  return payload;
}

void enqueueOffline(const String &payload) {
  if (queueCount == OFFLINE_QUEUE_SIZE) {
    queueHead = (queueHead + 1) % OFFLINE_QUEUE_SIZE;
    queueCount--;
  }
  const size_t index = (queueHead + queueCount) % OFFLINE_QUEUE_SIZE;
  offlineQueue[index] = payload;
  queueCount++;
}

void flushOfflineQueue() {
  while (mqtt.connected() && queueCount > 0) {
    if (!mqtt.publish(telemetryTopic().c_str(), offlineQueue[queueHead].c_str(), false)) return;
    offlineQueue[queueHead] = "";
    queueHead = (queueHead + 1) % OFFLINE_QUEUE_SIZE;
    queueCount--;
  }
}

void publishEvent(const char *event, const char *commandId, bool success, const char *message) {
  JsonDocument doc;
  doc["schemaVersion"] = 1;
  doc["deviceId"] = config().deviceId;
  doc["event"] = event;
  doc["commandId"] = commandId;
  doc["success"] = success;
  doc["message"] = message;
  String payload;
  serializeJson(doc, payload);
  mqtt.publish(eventTopic().c_str(), payload.c_str(), false);
}

void handleCommand(char *, byte *payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;

  const char *commandId = doc["commandId"] | "unknown";
  const char *action = doc["action"] | "";
  bool handled = true;

  if (strcmp(action, "set") == 0) {
    setLamp(doc["on"] | currentState.relayOn, doc["brightness"] | currentState.brightness);
  } else if (strcmp(action, "identify") == 0) {
    for (int i = 0; i < 6; i++) {
      digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));
      delay(150);
    }
  } else if (strcmp(action, "sampleNow") == 0) {
    lastTelemetryAt = 0;
  } else if (strcmp(action, "restart") == 0) {
    publishEvent("commandAck", commandId, true, "Restarting");
    delay(250);
    ESP.restart();
  } else {
    handled = false;
  }

  lastCommandAt = millis();
  publishEvent("commandAck", commandId, handled, handled ? "Command applied" : "Unknown command");
}

bool connectCellular() {
  esp_task_wdt_reset();
  if (!modem.restart()) return false;
  esp_task_wdt_reset();
  if (config().simPin.length() > 0 && modem.getSimStatus() != 3) {
    modem.simUnlock(config().simPin.c_str());
  }
  if (!modem.waitForNetwork(NETWORK_WAIT_MS)) return false;
  esp_task_wdt_reset();
  return modem.gprsConnect(config().apn.c_str(), config().apnUser.c_str(),
                           config().apnPassword.c_str());
}

bool connectMqtt() {
  if (!modem.isNetworkConnected() && !connectCellular()) return false;
  const String clientId =
      String("ecolume-") + config().deviceId + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  if (!mqtt.connect(clientId.c_str(), config().deviceId.c_str(), config().deviceToken.c_str())) {
    return false;
  }
  mqtt.subscribe(commandTopic().c_str(), 1);
  publishEvent("online", "", true, "Device connected");
  flushOfflineQueue();
  return true;
}

void setup() {
  Serial.begin(115200);
  provisioning::begin();
  pinMode(LED_RELAY_PIN, OUTPUT);
  pinMode(CABINET_TAMPER_PIN, INPUT_PULLUP);
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(MODEM_POWER_ON_PIN, OUTPUT);
  pinMode(MODEM_PWRKEY_PIN, OUTPUT);
  digitalWrite(MODEM_POWER_ON_PIN, HIGH);
  digitalWrite(MODEM_PWRKEY_PIN, HIGH);

  ledcSetup(0, 5000, 8);
  ledcAttachPin(LED_DIM_PIN, 0);
  setLamp(true, SAFE_NIGHT_BRIGHTNESS);

  Wire.begin();
  powerMeter.begin();
  ambientSensor.begin(BH1750::CONTINUOUS_HIGH_RES_MODE);

  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(3000);
  modem.enableGPS();

#if defined(TINY_GSM_MODEM_HAS_SSL)
  networkClient.setCACert(config().rootCa.length() > 0 ? config().rootCa.c_str() : MQTT_ROOT_CA);
#endif
  // PubSubClient keeps the pointer it is given, so the host string has to stay
  // alive: provisioning settings are loaded once and never rewritten in place.
  mqtt.setServer(config().mqttHost.c_str(), config().mqttPort);
  mqtt.setCallback(handleCommand);
  mqtt.setBufferSize(1536);
  mqtt.setKeepAlive(60);

  esp_task_wdt_init(WATCHDOG_TIMEOUT_S, true);
  esp_task_wdt_add(nullptr);
  lastCommandAt = millis();
}

void loop() {
  esp_task_wdt_reset();
  provisioning::poll();

  const bool mayConnect = provisioning::isConfigured() && transportPermitted();
  if (mayConnect && !mqtt.connected() && millis() >= nextConnectAttemptAt) {
    if (connectMqtt()) {
      connectBackoffMs = CONNECT_BACKOFF_MIN_MS;
    } else {
      const uint32_t doubled = connectBackoffMs * 2;
      connectBackoffMs = doubled > CONNECT_BACKOFF_MAX_MS ? CONNECT_BACKOFF_MAX_MS : doubled;
    }
    nextConnectAttemptAt = millis() + connectBackoffMs;
  }
  mqtt.loop();

  const uint32_t now = millis();
  if (!mayConnect && (lastGuidanceAt == 0 || now - lastGuidanceAt >= GUIDANCE_INTERVAL_MS)) {
    lastGuidanceAt = now;
    if (!provisioning::isConfigured()) {
      Serial.println(F("! not provisioned - the lamp is on the local safety schedule."
                       " Type 'help' to configure this controller."));
    } else {
      Serial.println(F("! this build has no TLS transport for the modem, so telemetry is held"
                       " back. Use a TLS-capable gateway, or accept plaintext on an isolated"
                       " bench network with: set mqtt.insecure true"));
    }
  }
  if (lastTelemetryAt == 0 || now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    sampleSensors();
    const String payload = serializeTelemetry();
    if (!mqtt.connected() || !mqtt.publish(telemetryTopic().c_str(), payload.c_str(), false)) {
      enqueueOffline(payload);
    }
    lastTelemetryAt = now;
  }

  // If central control is unavailable, keep the light in a safe operational state.
  if (now - lastCommandAt > COMMAND_WATCHDOG_MS && !currentState.relayOn) {
    setLamp(true, FAILSAFE_BRIGHTNESS);
    lastCommandAt = now;
  }

  delay(25);
}

