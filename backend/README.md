# Backend (single service)

This backend is designed to run together with the frontend in one Zeabur service.

## Production start

Use Gunicorn and serve the built frontend:

```bash
gunicorn --bind 0.0.0.0:$PORT "app:create_app()"
```

When `frontend/dist/index.html` exists, Flask serves it for all non-API routes.

## Environment

- `SECRET_KEY` and `JWT_SECRET_KEY`
- `DATABASE_URL` (optional; defaults to sqlite)
- `FRONTEND_URL` (optional; restrict CORS)
