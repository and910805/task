# ---- 1) Build Frontend (Vite + React) ----
FROM node:20-bookworm-slim AS frontend_builder
WORKDIR /app/frontend

ENV CI=true \
    npm_config_optional=true \
    npm_config_fund=false \
    npm_config_audit=false

COPY frontend/package.json frontend/package-lock.json ./
# npm optional deps (esbuild platform package) may be skipped on some builders.
# Use npm install with optional deps explicitly enabled for best cross-platform compatibility.
RUN npm cache clean --force && npm install --include=dev --include=optional

COPY frontend/ ./

# Optional: set VITE_API_BASE_URL at build time if you split domains
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build -- --debug


# ---- 2) Backend (Flask + Gunicorn) ----
FROM python:3.12-slim AS backend
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend
COPY --from=frontend_builder /app/frontend/dist ./frontend/dist
COPY data/ ./data

# A writable directory for SQLite + uploads (mount a Zeabur volume here if you need persistence)
RUN mkdir -p /app/backend/uploads

ENV PYTHONUNBUFFERED=1

CMD ["sh", "-c", "gunicorn --chdir backend -w ${WEB_CONCURRENCY:-1} --threads ${WEB_THREADS:-2} -b 0.0.0.0:${PORT:-5000} app:app"]
