#!/usr/bin/env bash
#
# Packages a PlatformIO build into the artifacts the browser installer needs:
# a single merged flash image, an ESP Web Tools manifest, and checksums.
#
#   firmware/scripts/package-firmware.sh <version> [environment] [output-dir]
#
# Run it after `pio run -e <environment>`. Everything it produces is derived
# from that build, so a web install and a local flash are the same binary.
set -euo pipefail

VERSION="${1:?usage: package-firmware.sh <version> [environment] [output-dir]}"
ENVIRONMENT="${2:-esp32-sim7600-release}"
OUT_DIR="${3:-firmware/dist}"
CHANNEL="${FIRMWARE_CHANNEL:-stable}"
RELEASE_URL="${FIRMWARE_RELEASE_URL:-https://github.com/SengPhirum/PLXY_EcoLume/releases}"
COMMIT="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"

BUILD_DIR="firmware/.pio/build/${ENVIRONMENT}"
[ -d "$BUILD_DIR" ] || { echo "No build in ${BUILD_DIR}; run: pio run -d firmware -e ${ENVIRONMENT}" >&2; exit 1; }

# Flash layout for the esp32dev board with the default Arduino partition table.
BOOTLOADER="${BUILD_DIR}/bootloader.bin"
PARTITIONS="${BUILD_DIR}/partitions.bin"
APPLICATION="${BUILD_DIR}/firmware.bin"
BOOT_APP0="$(find "${PLATFORMIO_CORE_DIR:-$HOME/.platformio}/packages" -name boot_app0.bin -print -quit)"

for file in "$BOOTLOADER" "$PARTITIONS" "$APPLICATION" "$BOOT_APP0"; do
  [ -n "$file" ] && [ -f "$file" ] || { echo "Missing build artifact: ${file:-boot_app0.bin}" >&2; exit 1; }
done

IMAGE_NAME="ecolume-esp32-${VERSION}.bin"
mkdir -p "$OUT_DIR"

esptool.py --chip esp32 merge_bin -o "${OUT_DIR}/${IMAGE_NAME}" \
  --flash_mode dio --flash_freq 40m --flash_size 4MB \
  0x1000 "$BOOTLOADER" \
  0x8000 "$PARTITIONS" \
  0xe000 "$BOOT_APP0" \
  0x10000 "$APPLICATION"

cp "$APPLICATION" "${OUT_DIR}/ecolume-esp32-${VERSION}-app.bin"

cat > "${OUT_DIR}/manifest.json" <<JSON
{
  "name": "PLXY EcoLume field controller",
  "version": "${VERSION}",
  "new_install_prompt_erase": true,
  "builds": [
    {
      "chipFamily": "ESP32",
      "parts": [
        { "path": "${IMAGE_NAME}", "offset": 0 }
      ]
    }
  ],
  "ecolume": {
    "channel": "${CHANNEL}",
    "built": "$(date -u +%Y-%m-%d)",
    "environment": "${ENVIRONMENT}",
    "commit": "${COMMIT}",
    "releaseUrl": "${RELEASE_URL}"
  }
}
JSON

( cd "$OUT_DIR" && sha256sum ./*.bin manifest.json > SHA256SUMS )

echo "Packaged EcoLume ${VERSION} into ${OUT_DIR}:"
ls -lh "$OUT_DIR"
