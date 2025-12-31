# Backend deployment notes

To avoid `ModuleNotFoundError: No module named 'flask'` on Zeabur:

1. **Root Directory**: Configure the service Root Directory as `backend` so Zeabur can find `requirements.txt`.
2. **Dependencies**: Keep `requirements.txt` in this folder; it lists all backend packages Zeabur should install.
3. **Start Command**: Use a production server instead of `python app.py`, e.g.:
   ```bash
   gunicorn --bind 0.0.0.0:$PORT "app:create_app()"
   ```

The app entry point already reads `PORT` from the environment, binds to `0.0.0.0`, and CORS support lives in `app/__init__.py`.
