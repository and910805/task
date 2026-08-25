# ---- 1) Build Frontend (Vite + React) ----
FROM node:20-bookworm-slim AS frontend_builder
WORKDIR /app/frontend

ENV CI=true \
    npm_config_optional=true \
    npm_config_fund=false \
    npm_config_audit=false

COPY frontend/package.json frontend/package-lock.json ./
# Reproducible install from the committed lockfile, including the platform-specific
# optional package used by esbuild.
RUN npm cache clean --force && npm ci --include=dev --include=optional

COPY frontend/ ./

# Optional: set VITE_API_BASE_URL at build time if you split domains
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build -- --debug


# ---- 2) Backend (Flask + Gunicorn) ----
FROM python:3.12-slim AS backend
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# reportlab may fail to load TTC subfonts and does not support CFF OTF outlines.
# Download a TTF (variable font) fallback that reportlab can embed reliably.
RUN mkdir -p /usr/local/share/fonts \
    && python -c "from urllib.request import urlopen; u='https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf'; o='/usr/local/share/fonts/NotoSansTC-wght.ttf'; open(o,'wb').write(urlopen(u, timeout=60).read()); print('downloaded', o)"

# Formal contracts use a serif face while estimates keep the existing sans face.
RUN python -c "from urllib.request import urlopen; u='https://raw.githubusercontent.com/google/fonts/main/ofl/notoseriftc/NotoSerifTC%5Bwght%5D.ttf'; o='/usr/local/share/fonts/NotoSerifTC-wght.ttf'; open(o,'wb').write(urlopen(u, timeout=60).read()); print('downloaded', o)"

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend
COPY --from=frontend_builder /app/frontend/dist ./frontend/dist
COPY data/ ./data

# A writable directory for SQLite + uploads (mount a Zeabur volume here if you need persistence)
RUN mkdir -p /app/backend/uploads

ENV PYTHONUNBUFFERED=1
ENV UPLOAD_FOLDER=/app/backend/uploads
ENV PDF_FONT_PATH=/usr/local/share/fonts/NotoSansTC-wght.ttf
ENV CONTRACT_PDF_FONT_PATH=/usr/local/share/fonts/NotoSerifTC-wght.ttf
ENV PDF_REQUIRE_EMBEDDED_FONT=1
ENV INIT_DB_ON_STARTUP=1

CMD ["sh", "-c", "APP_PORT=${WEB_PORT:-${PORT:-5000}}; case \"$APP_PORT\" in ''|*[!0-9]*) APP_PORT=5000 ;; esac; gunicorn --chdir backend -w ${WEB_CONCURRENCY:-1} --threads ${WEB_THREADS:-2} --timeout ${WEB_TIMEOUT:-120} --graceful-timeout 30 -b 0.0.0.0:${APP_PORT} app:app"]
