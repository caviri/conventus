# syntax=docker/dockerfile:1

# ---------- Stage 1: build the React SPA ----------
FROM node:20-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: Python runtime ----------
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_DIR=/data \
    STATIC_DIR=/app/static \
    PORT=7860 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# uv binary (pinned) for fast, fully-locked dependency installs.
COPY --from=ghcr.io/astral-sh/uv:0.11.19 /uv /usr/local/bin/uv

# Install the locked dependencies into /app/.venv. Cached unless the lock or
# manifest change; the venv is on PATH so `uvicorn` below resolves from it.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev

COPY backend/app ./app
COPY --from=frontend /frontend/dist ./static

# Hugging Face Spaces (and most PaaS) provide persistent storage at /data.
RUN mkdir -p /data && chmod 777 /data
VOLUME ["/data"]

EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
