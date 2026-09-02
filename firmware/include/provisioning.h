#pragma once

#include <Arduino.h>

// The release workflow writes include/version.h; a plain `pio run` has none and
// falls back to the development version below.
#if defined(__has_include)
#if __has_include("version.h")
#include "version.h"
#endif
#endif

#ifndef ECOLUME_FIRMWARE_VERSION
#define ECOLUME_FIRMWARE_VERSION "0.0.0-dev"
#endif

// Effective controller configuration: values stored in non-volatile storage,
// falling back to whatever was compiled into config.h.
struct DeviceSettings {
  String deviceId;
  String deviceToken;
  String apn;
  String apnUser;
  String apnPassword;
  String simPin;
  String mqttHost;
  uint16_t mqttPort = 8883;
  String topicPrefix;
  String rootCa;             // PEM root certificate, empty to use the compiled one
  bool allowInsecure = false; // operator opt-in to plaintext MQTT
};

namespace provisioning {

// Loads stored settings and prints the boot banner. Call once from setup().
void begin();

// Services the serial provisioning console. Call from loop().
void poll();

// Effective settings. Console changes are written to storage and take effect
// on the next boot, so the returned strings stay valid for the whole run.
const DeviceSettings &settings();

// True once the controller carries a real identity rather than the placeholders
// shipped in config.example.h.
bool isConfigured();

void printBanner(Print &out);

}  // namespace provisioning
