.PHONY: install dev test typecheck build up down logs firmware firmware-release docs docs-serve verify

install:
	cd backend && npm install

dev:
	cd backend && npm run dev

test:
	cd backend && npm test

typecheck:
	cd backend && npm run typecheck

build:
	cd backend && npm run build

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f backend

firmware:
	cd firmware && pio run

# Reproduces the published installer artifacts in firmware/dist/.
firmware-release:
	printf '#define ECOLUME_FIRMWARE_VERSION "$(VERSION)"\n' > firmware/include/version.h
	pio run -d firmware -e esp32-sim7600-release
	firmware/scripts/package-firmware.sh "$(VERSION)"

docs:
	npm --prefix docs-site ci
	npm --prefix docs-site run build
	npm --prefix docs-site run verify

docs-serve:
	npm --prefix docs-site run serve

verify: typecheck test docs

