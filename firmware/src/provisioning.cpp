#include "provisioning.h"

#include <Preferences.h>

#include "config.h"

namespace {

constexpr char STORE_NAMESPACE[] = "ecolume";
constexpr char PLACEHOLDER_TOKEN[] = "replace-with-unique-random-device-token";
constexpr size_t MAX_LINE_BYTES = 200;
constexpr size_t MAX_CA_BYTES = 3800;

DeviceSettings current;
String inputLine;
String caBuffer;
bool capturingCa = false;

struct Field {
  const char *name;  // console name
  const char *key;   // storage key (NVS keys are limited to 15 characters)
  bool secret;
};

const Field FIELDS[] = {
    {"device.id", "deviceId", false},
    {"device.token", "devToken", true},
    {"apn", "apn", false},
    {"apn.user", "apnUser", false},
    {"apn.password", "apnPass", true},
    {"sim.pin", "simPin", true},
    {"mqtt.host", "mqttHost", false},
    {"mqtt.port", "mqttPort", false},
    {"mqtt.prefix", "mqttPrefix", false},
    {"mqtt.insecure", "insecure", false},
};

constexpr size_t FIELD_COUNT = sizeof(FIELDS) / sizeof(FIELDS[0]);

const Field *findField(const String &name) {
  for (size_t i = 0; i < FIELD_COUNT; i++) {
    if (name.equals(FIELDS[i].name)) return &FIELDS[i];
  }
  return nullptr;
}

String storedOr(Preferences &store, const char *key, const char *fallback) {
  const String value = store.getString(key, String());
  return value.length() > 0 ? value : String(fallback);
}

void loadFromStore() {
  Preferences store;
  store.begin(STORE_NAMESPACE, true);
  current.deviceId = storedOr(store, "deviceId", DEVICE_ID);
  current.deviceToken = storedOr(store, "devToken", DEVICE_TOKEN);
  current.apn = storedOr(store, "apn", CELLULAR_APN);
  current.apnUser = storedOr(store, "apnUser", CELLULAR_USER);
  current.apnPassword = storedOr(store, "apnPass", CELLULAR_PASSWORD);
  current.simPin = storedOr(store, "simPin", CELLULAR_PIN);
  current.mqttHost = storedOr(store, "mqttHost", MQTT_HOST);
  current.mqttPort = store.getUShort("mqttPort", MQTT_PORT);
  current.topicPrefix = storedOr(store, "mqttPrefix", MQTT_TOPIC_PREFIX);
  current.rootCa = store.getString("mqttCa", String());
  current.allowInsecure = store.getBool("insecure", false);
  store.end();
}

bool writeString(const char *key, const String &value) {
  Preferences store;
  if (!store.begin(STORE_NAMESPACE, false)) return false;
  if (value.length() == 0) {
    store.remove(key);
    store.end();
    return true;
  }
  const bool ok = store.putString(key, value) > 0;
  store.end();
  return ok;
}

bool writeUShort(const char *key, uint16_t value) {
  Preferences store;
  if (!store.begin(STORE_NAMESPACE, false)) return false;
  const bool ok = store.putUShort(key, value) > 0;
  store.end();
  return ok;
}

bool writeBool(const char *key, bool value) {
  Preferences store;
  if (!store.begin(STORE_NAMESPACE, false)) return false;
  const bool ok = store.putBool(key, value) > 0;
  store.end();
  return ok;
}

void removeKey(const char *key) {
  Preferences store;
  if (!store.begin(STORE_NAMESPACE, false)) return;
  store.remove(key);
  store.end();
}

void printPadded(Print &out, const char *label) {
  out.print(F("  "));
  out.print(label);
  for (size_t i = strlen(label); i < 16; i++) out.print(' ');
}

void printValue(Print &out, const char *label, const String &value, bool secret) {
  printPadded(out, label);
  if (value.length() == 0) {
    out.println(F("(unset)"));
  } else if (secret) {
    out.print(F("******** ("));
    out.print(value.length());
    out.println(F(" characters)"));
  } else {
    out.println(value);
  }
}

void printHelp(Print &out) {
  out.println(F("EcoLume provisioning console"));
  out.println(F("  show                  current configuration, secrets masked"));
  out.println(F("  set <name> <value>    store a setting"));
  out.println(F("  clear <name>          remove a stored setting"));
  out.println(F("  set-ca                paste a PEM root certificate, then a line: END"));
  out.println(F("  factory-reset         erase every stored setting"));
  out.println(F("  reboot                restart the controller"));
  out.println(F("  help                  this list"));
  out.print(F("  names: "));
  for (size_t i = 0; i < FIELD_COUNT; i++) {
    if (i > 0) out.print(F(", "));
    out.print(FIELDS[i].name);
  }
  out.println();
  out.println(F("Stored settings are applied on the next boot."));
}

void printConfiguration(Print &out) {
  out.println(F("Configuration"));
  printValue(out, "device.id", current.deviceId, false);
  printValue(out, "device.token", current.deviceToken, true);
  printValue(out, "apn", current.apn, false);
  printValue(out, "apn.user", current.apnUser, false);
  printValue(out, "apn.password", current.apnPassword, true);
  printValue(out, "sim.pin", current.simPin, true);
  printValue(out, "mqtt.host", current.mqttHost, false);
  printValue(out, "mqtt.port", String(current.mqttPort), false);
  printValue(out, "mqtt.prefix", current.topicPrefix, false);
  printPadded(out, "mqtt.ca");
  out.println(current.rootCa.length() > 0 ? F("stored in device memory") : F("compiled into the firmware"));
  printPadded(out, "mqtt.insecure");
  out.println(current.allowInsecure ? F("true") : F("false"));
  printPadded(out, "provisioned");
  out.println(provisioning::isConfigured() ? F("yes") : F("no"));
}

void finishCaCapture() {
  capturingCa = false;
  if (caBuffer.length() > MAX_CA_BYTES) {
    Serial.println(F("! certificate is too large, nothing stored"));
  } else if (caBuffer.indexOf("-----BEGIN CERTIFICATE-----") < 0) {
    Serial.println(F("! no PEM certificate found, nothing stored"));
  } else if (writeString("mqttCa", caBuffer)) {
    Serial.print(F("stored root certificate ("));
    Serial.print(caBuffer.length());
    Serial.println(F(" bytes), reboot to apply"));
  } else {
    Serial.println(F("! could not store the certificate"));
  }
  caBuffer = "";
}

void applySet(const String &rest) {
  const int space = rest.indexOf(' ');
  if (space < 0) {
    Serial.println(F("! usage: set <name> <value>"));
    return;
  }
  String name = rest.substring(0, space);
  String value = rest.substring(space + 1);
  name.toLowerCase();
  value.trim();
  const Field *field = findField(name);
  if (field == nullptr) {
    Serial.print(F("! unknown setting: "));
    Serial.println(name);
    return;
  }

  bool ok;
  if (name == "mqtt.port") {
    const long port = value.toInt();
    if (port <= 0 || port > 65535) {
      Serial.println(F("! port must be between 1 and 65535"));
      return;
    }
    ok = writeUShort(field->key, static_cast<uint16_t>(port));
  } else if (name == "mqtt.insecure") {
    const bool enabled =
        value.equalsIgnoreCase("true") || value == "1" || value.equalsIgnoreCase("yes");
    ok = writeBool(field->key, enabled);
    if (ok && enabled) {
      Serial.println(F("! plaintext MQTT enabled - use only on an isolated bench network"));
    }
  } else {
    ok = writeString(field->key, value);
  }
  Serial.println(ok ? F("stored, reboot to apply") : F("! could not store the setting"));
}

void handleLine(String line) {
  if (capturingCa) {
    line.trim();
    if (line == "END") {
      finishCaCapture();
      return;
    }
    if (caBuffer.length() + line.length() + 1 <= MAX_CA_BYTES + 64) {
      caBuffer += line;
      caBuffer += '\n';
    }
    return;
  }

  line.trim();
  if (line.length() == 0) return;

  const int space = line.indexOf(' ');
  String command = space < 0 ? line : line.substring(0, space);
  String rest = space < 0 ? String() : line.substring(space + 1);
  command.toLowerCase();
  rest.trim();

  if (command == "help" || command == "?") {
    printHelp(Serial);
  } else if (command == "show" || command == "status") {
    provisioning::printBanner(Serial);
    printConfiguration(Serial);
  } else if (command == "set") {
    applySet(rest);
  } else if (command == "clear") {
    rest.toLowerCase();
    if (rest == "mqtt.ca") {
      removeKey("mqttCa");
      Serial.println(F("cleared, reboot to apply"));
      return;
    }
    const Field *field = findField(rest);
    if (field == nullptr) {
      Serial.print(F("! unknown setting: "));
      Serial.println(rest);
      return;
    }
    removeKey(field->key);
    Serial.println(F("cleared, reboot to apply"));
  } else if (command == "set-ca") {
    capturingCa = true;
    caBuffer = "";
    Serial.println(F("paste the PEM certificate, then a line containing only: END"));
  } else if (command == "factory-reset") {
    Preferences store;
    if (store.begin(STORE_NAMESPACE, false)) {
      store.clear();
      store.end();
      Serial.println(F("every stored setting erased, reboot to apply"));
    } else {
      Serial.println(F("! could not open device storage"));
    }
  } else if (command == "reboot" || command == "restart") {
    Serial.println(F("restarting"));
    Serial.flush();
    delay(120);
    ESP.restart();
  } else {
    Serial.print(F("! unknown command: "));
    Serial.println(command);
    Serial.println(F("  type 'help' for the command list"));
  }
}

}  // namespace

namespace provisioning {

void begin() {
  loadFromStore();
  printBanner(Serial);
  if (!isConfigured()) {
    Serial.println(F("This controller has not been provisioned."));
    Serial.println(F("Type 'help' to set the device identity, APN, and broker."));
  }
}

void poll() {
  while (Serial.available() > 0) {
    const char character = static_cast<char>(Serial.read());
    if (character == '\r') continue;
    if (character == '\n') {
      handleLine(inputLine);
      inputLine = "";
      continue;
    }
    if (inputLine.length() < MAX_LINE_BYTES) inputLine += character;
  }
}

const DeviceSettings &settings() {
  return current;
}

bool isConfigured() {
  return current.deviceId.length() > 0 && current.mqttHost.length() > 0 &&
         current.deviceToken.length() >= 8 && current.deviceToken != PLACEHOLDER_TOKEN;
}

void printBanner(Print &out) {
  out.println();
  out.print(F("PLXY EcoLume field controller "));
  out.println(F(ECOLUME_FIRMWARE_VERSION));
  out.print(F("  device  "));
  out.println(current.deviceId.length() > 0 ? current.deviceId : String(F("(unset)")));
  out.print(F("  broker  "));
  out.print(current.mqttHost);
  out.print(':');
  out.println(current.mqttPort);
}

}  // namespace provisioning
