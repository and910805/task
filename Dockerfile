# ---- 1) Build Frontend (Vite + React) ----
FROM node:20-alpine AS frontend_builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Optional: set VITE_API_BASE_URL at build time if you split domains
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build


# ---- 2) Backend (Flask + Gunicorn) ----
FROM python:3.12-slim AS backend
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend
COPY --from=frontend_builder /app/frontend/dist ./frontend/dist

# A writable directory for SQLite + uploads (mount a Zeabur volume here if you need persistence)
RUN mkdir -p /app/backend/uploads

ENV PYTHONUNBUFFERED=1

CMD ["sh", "-c", "gunicorn --chdir backend -w ${WEB_CONCURRENCY:-1} --threads ${WEB_THREADS:-2} -b 0.0.0.0:${PORT:-5000} app:app"]
