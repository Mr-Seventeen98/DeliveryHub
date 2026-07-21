.PHONY: install dev build test lint typecheck db-generate db-migrate db-seed up down logs

install:
	pnpm install

dev:
	pnpm dev

build:
	pnpm build

test:
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck

db-generate:
	pnpm db:generate

db-migrate:
	pnpm db:migrate

db-seed:
	pnpm db:seed

up:
	docker compose --env-file .env -f deploy/docker-compose.yml up --build -d

down:
	docker compose --env-file .env -f deploy/docker-compose.yml down

logs:
	docker compose --env-file .env -f deploy/docker-compose.yml logs -f --tail=200
