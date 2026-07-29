.PHONY: install dev test typecheck build up down logs firmware

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

