# Development shortcuts. `make` on its own lists the targets.
.DEFAULT_GOAL := help
SHELL := /bin/bash

PY := .venv/bin/python
PIP := .venv/bin/pip

.PHONY: help setup api web ingest test build up down logs clean

help: ## list targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

setup: ## install python + node dependencies
	python3 -m venv .venv
	$(PIP) install -q --upgrade pip
	$(PIP) install -q -r backend/requirements.txt -r backend/requirements-dev.txt
	pnpm --dir frontend install

api: ## run FastAPI on :8010 (hot reload)
	cd backend && PYTHONPATH=. ../$(PY) -m uvicorn app.main:app --reload --port 8010

web: ## run Vite on :5173 (proxies /api to :8010)
	pnpm --dir frontend dev

ingest: ## refresh the SQLite warehouse from Elexon
	cd backend && PYTHONPATH=. ../$(PY) -m app.ingest

test: ## run the backend test suite
	cd backend && PYTHONPATH=. ../$(PY) -m pytest -q

build: ## build the production image
	docker build -t aeolus:local .

up: ## build and run the whole app on :8000
	docker compose up --build

down: ## stop the container
	docker compose down

logs: ## tail the container logs
	docker compose logs -f

clean: ## remove local artefacts
	rm -rf backend/.pytest_cache frontend/dist
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
