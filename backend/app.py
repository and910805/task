import os
import sys
from datetime import timedelta

from flask import Flask, jsonify, redirect, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import verify_jwt_in_request

# Ensure local imports work when gunicorn --chdir backend
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from extensions import db, jwt
from storage import StorageError, create_storage


def _parse_cors_origins(raw: str | None) -> list[str]:
    if not raw:
        return ["http://localhost:5173"]
    return [item.strip() for item in raw.split(",") if item.strip()]


def _normalize_database_url(db_url: str | None) -> str | None:
    if not db_url:
        return None
    if db_url.startswith("postgres://"):
        return db_url.replace("postgres://", "postgresql://", 1)
    return db_url


def create_app() -> Flask:
    base_dir = os.path.dirname(os.path.abspath(__file__))

    uploads_path = os.path.join(base_dir, "uploads")
    os.makedirs(uploads_path, exist_ok=True)

    database_path = os.path.join(uploads_path, "task_manager.db")
    frontend_dist_path = os.path.abspath(os.path.join(base_dir, "..", "frontend", "dist"))

    app = Flask(__name__, static_folder=frontend_dist_path, static_url_path="/")

    reports_path = os.path.join(uploads_path, "reports")
    images_path = os.path.join(uploads_path, "images")
    audio_path = os.path.join(uploads_path, "audio")
    signature_path = os.path.join(uploads_path, "signature")
    other_path = os.path.join(uploads_path, "other")

    secret_key = os.getenv("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY is required (set it in Zeabur Variables).")

    jwt_secret = os.environ.get("JWT_SECRET_KEY", secret_key)
    database_url = _normalize_database_url(os.environ.get("DATABASE_URL"))
    cors_origins = _parse_cors_origins(os.environ.get("CORS_ORIGINS"))

    app.config.update(
        SECRET_KEY=secret_key,
        JWT_SECRET_KEY=jwt_secret,
        SQLALCHEMY_DATABASE_URI=database_url or f"sqlite:///{database_path}",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=1),
        JWT_TOKEN_LOCATION=["headers"],
        UPLOAD_FOLDER=uploads_path,
        UPLOAD_IMAGE_DIR=images_path,
        UPLOAD_AUDIO_DIR=audio_path,
        UPLOAD_SIGNATURE_DIR=signature_path,
        REPORTS_DIR=reports_path,
        STORAGE_MODE=os.environ.get("STORAGE_MODE", "local"),
        MAX_CONTENT_LENGTH=16 * 1024 * 1024,
        CORS_ORIGINS=cors_origins,
    )

    for folder in (uploads_path, reports_path, images_path, audio_path, signature_path, other_path):
        os.makedirs(folder, exist_ok=True)

    CORS(app, supports_credentials=True, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    db.init_app(app)
    jwt.init_app(app)

    try:
        storage_backend = create_storage(app.config)
    except StorageError as exc:
        raise RuntimeError(f"Failed to configure storage backend: {exc}") from exc
    app.extensions["storage"] = storage_backend

    from routes.auth import auth_bp
    from routes.export import export_bp
    from routes.settings import settings_bp
    from routes.tasks import tasks_bp
    from routes.uploads import upload_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(tasks_bp, url_prefix="/api/tasks")
    app.register_blueprint(upload_bp, url_prefix="/api/upload")
    app.register_blueprint(export_bp, url_prefix="/api/export")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")

    @app.route("/api/health")
    def health_check():
        return jsonify({"status": "ok"}), 200

    @app.before_request
    def _check_auth_and_redirect():
        if request.method == "OPTIONS":
            return None
        path = request.path or "/"
        public_paths = {"/", "/login", "/favicon.ico", "/index.html", "/api/auth/login", "/api/auth/register", "/api/health"}
        if path in public_paths or path.startswith(("/static/", "/assets/", "/api/")):
            return None
        try:
            verify_jwt_in_request()
        except Exception:
            return redirect("/", code=302)

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_react(path: str):
        if path.startswith(("api/", "uploads/", "static/", "favicon.", "manifest", "robots")):
            return jsonify({"error": "Not found"}), 404
        dist_dir = app.static_folder
        requested_path = os.path.join(dist_dir, path)
        if os.path.exists(requested_path) and not os.path.isdir(requested_path):
            return send_from_directory(dist_dir, path)
        return send_from_directory(dist_dir, "index.html")

    with app.app_context():
        from models import Attachment, RoleLabel, SiteSetting, Task, TaskUpdate, User
        db.create_all()

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
