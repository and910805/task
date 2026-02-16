import os
import sys
from datetime import timedelta
from urllib.parse import quote

import click
from sqlalchemy import text
from sqlalchemy import inspect

from flask import Flask, jsonify, redirect, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import verify_jwt_in_request
from werkzeug.middleware.proxy_fix import ProxyFix
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
        return db_url.replace("postgres://", "postgresql+psycopg://", 1)
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    if db_url.startswith("postgresql+psycopg2://"):
        return db_url.replace("postgresql+psycopg2://", "postgresql+psycopg://", 1)
    return db_url


def create_app() -> Flask:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    marketing_photo_dir = os.path.abspath(os.path.join(base_dir, "..", "data", "photo"))

    uploads_path = os.path.join(base_dir, "uploads")
    os.makedirs(uploads_path, exist_ok=True)

    database_path = os.path.join(uploads_path, "task_manager.db")
    frontend_dist_path = os.path.abspath(os.path.join(base_dir, "..", "frontend", "dist"))

    # Avoid clashing with SPA routes like /login; we serve frontend files via serve_react().
    app = Flask(__name__, static_folder=frontend_dist_path, static_url_path="/__static__")
    app.url_map.strict_slashes = False
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
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
    from routes.locations import site_locations_bp
    from routes.settings import settings_bp
    from routes.tasks import tasks_bp
    from routes.uploads import upload_bp
    from routes.line import line_bp
    from routes.crm import crm_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(tasks_bp, url_prefix="/api/tasks")
    app.register_blueprint(upload_bp, url_prefix="/api/upload")
    app.register_blueprint(export_bp, url_prefix="/api/export")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")
    app.register_blueprint(line_bp, url_prefix="/api/line")
    app.register_blueprint(site_locations_bp, url_prefix="/api/site-locations")
    app.register_blueprint(crm_bp, url_prefix="/api/crm")

    @app.route("/api/health")
    def health_check():
        return jsonify({"status": "ok"}), 200

    @app.before_request
    def _check_auth_and_redirect():
        if request.method == "OPTIONS":
            return None
        path = request.path or "/"
        public_paths = {"/", "/login", "/favicon.ico", "/index.html", "/api/auth/login", "/api/auth/register", "/api/health"}
        if path in public_paths or path.startswith(("/static/", "/assets/", "/api/", "/salesite/", "/photo/")):
            return None
        try:
            verify_jwt_in_request()
        except Exception:
            return redirect("/", code=302)

    @app.route("/api/public/photos")
    def public_photo_list():
        if not os.path.isdir(marketing_photo_dir):
            return jsonify([]), 200
        allowed_ext = (".png", ".jpg", ".jpeg", ".webp", ".gif")
        photos = []
        for filename in sorted(os.listdir(marketing_photo_dir)):
            full_path = os.path.join(marketing_photo_dir, filename)
            if not os.path.isfile(full_path):
                continue
            if not filename.lower().endswith(allowed_ext):
                continue
            photos.append({"name": filename, "url": f"/photo/{quote(filename)}"})
        return jsonify(photos), 200

    @app.route("/photo/<path:filename>")
    def public_photo_file(filename: str):
        return send_from_directory(marketing_photo_dir, filename)

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_react(path: str):
        if path.startswith(("api/", "uploads/", "static/", "favicon.", "manifest", "robots")):
            return jsonify({"error": "Not found"}), 404
        dist_dir = app.static_folder
        sale_dir = os.path.join(dist_dir, "salesite")
        sale_entry = os.path.join(sale_dir, "sale.html")

        # Keep static sale page available at "/sale".
        if path == "sale":
            if os.path.exists(sale_entry):
                return send_from_directory(sale_dir, "sale.html")

        requested_path = os.path.join(dist_dir, path)
        if os.path.exists(requested_path) and not os.path.isdir(requested_path):
            return send_from_directory(dist_dir, path)
        return send_from_directory(dist_dir, "index.html")

    with app.app_context():
        from models import Attachment, RoleLabel, ServiceCatalogItem, SiteLocation, SiteSetting, Task, TaskUpdate, User
        db.create_all()
        _ensure_user_reminder_frequency_column()
        _ensure_task_location_url_column()
        _ensure_quote_item_unit_column()
        _ensure_invoice_item_unit_column()


    @app.cli.command("send-due-reminders")
    def send_due_reminders() -> None:
        """Send daily due-date reminders (for cron usage)."""
        from services.reminders import run_due_task_reminders

        count = run_due_task_reminders()
        click.echo(f"Sent {count} reminder notifications.")

    return app


def _ensure_user_reminder_frequency_column() -> None:
    inspector = inspect(db.engine)
    if "user" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("user")}
    if "reminder_frequency" in columns:
        return
    if db.engine.dialect.name != "sqlite":
        return
    db.session.execute(
        text("ALTER TABLE user ADD COLUMN reminder_frequency VARCHAR(16)")
    )
    db.session.execute(
        text("UPDATE user SET reminder_frequency = 'daily' WHERE reminder_frequency IS NULL")
    )
    db.session.commit()



def _ensure_task_location_url_column() -> None:
    inspector = inspect(db.engine)
    if "task" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("task")}
    if "location_url" in columns:
        return
    if db.engine.dialect.name != "sqlite":
        return
    db.session.execute(
        text("ALTER TABLE task ADD COLUMN location_url VARCHAR(500)")
    )
    db.session.commit()


def _ensure_quote_item_unit_column() -> None:
    inspector = inspect(db.engine)
    if "quote_item" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("quote_item")}
    if "unit" in columns:
        return
    if db.engine.dialect.name != "sqlite":
        return
    db.session.execute(text("ALTER TABLE quote_item ADD COLUMN unit VARCHAR(32)"))
    db.session.commit()


def _ensure_invoice_item_unit_column() -> None:
    inspector = inspect(db.engine)
    if "invoice_item" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("invoice_item")}
    if "unit" in columns:
        return
    if db.engine.dialect.name != "sqlite":
        return
    db.session.execute(text("ALTER TABLE invoice_item ADD COLUMN unit VARCHAR(32)"))
    db.session.commit()


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
