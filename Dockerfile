# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — build the React bundle.
# Kept separate so node and its ~300 MB of modules never reach the runtime image.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS web

ENV CI=true
RUN corepack enable
WORKDIR /build/frontend

# Dependency layer first: it only busts when the lockfile changes.
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 2 — Python runtime serving the API and the static bundle from one
# origin. One process, one port, one URL: no CORS, no second deploy target.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Mirror the repository layout inside the image. `config.BASE_DIR` is then
# `backend/`, exactly as it is on a developer's machine, so data/ and
# frontend/dist/ are discovered with no environment overrides at all.
COPY backend/app ./backend/app
COPY backend/data ./backend/data
COPY --from=web /build/frontend/dist ./frontend/dist

ENV PYTHONPATH=/app/backend
WORKDIR /app/backend

# Run as a non-root user: the container only ever reads the SQLite file.
RUN useradd --create-home --uid 10001 aeolus && chown -R aeolus:aeolus /app
USER aeolus

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2).status == 200 else 1)"

# Shell form so the platform-injected $PORT (Heroku, Render, Cloud Run) wins.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
