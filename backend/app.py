import os
from datetime import timedelta

from flask import Flask, abort, jsonify, redirect, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import verify_jwt_in_request

from extensions import db, jwt
from storage import create_storage, StorageError


def create_app() -> Flask:
    frontend_dist_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
    )

    app = Flask(__name__, static_folder=frontend_dist_path, static_url_path="/")

    base_dir = os.path.dirname(__file__)
    database_path = os.path.join(base_dir, "task_manager.db")
    uploads_path = os.path.join(base_dir, "uploads")
    reports_path = os.path.join(uploads_path, "reports")
    images_path = os.path.join(uploads_path, "images")
    audio_path = os.path.join(uploads_path, "audio")
    signature_path = os.path.join(uploads_path, "signature")
    other_path = os.path.join(uploads_path, "other")

    app.config.update(
        SECRET_KEY="super-secret-key",
        SQLALCHEMY_DATABASE_URI=f"sqlite:///{database_path}",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="jwt-secret-key",
        JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=1),
        JWT_TOKEN_LOCATION=["headers"],
        UPLOAD_FOLDER=uploads_path,
        UPLOAD_IMAGE_DIR=images_path,
        UPLOAD_AUDIO_DIR=audio_path,
        UPLOAD_SIGNATURE_DIR=signature_path,
        REPORTS_DIR=reports_path,
        STORAGE_MODE=os.environ.get("STORAGE_MODE", "local"),
        S3_BUCKET=os.environ.get("S3_BUCKET"),
        S3_BASE_PATH=os.environ.get("S3_BASE_PATH", ""),
        S3_REGION_NAME=os.environ.get("S3_REGION_NAME"),
        S3_ENDPOINT_URL=os.environ.get("S3_ENDPOINT_URL"),
        S3_URL_EXPIRY=int(os.environ.get("S3_URL_EXPIRY", "3600")),
        MAX_CONTENT_LENGTH=16 * 1024 * 1024,
    )

    for folder in (
        uploads_path,
        reports_path,
        images_path,
        audio_path,
        signature_path,
        other_path,
    ):
        os.makedirs(folder, exist_ok=True)

    CORS(app, supports_credentials=True)
    db.init_app(app)
    jwt.init_app(app)

    try:
        storage_backend = create_storage(app.config)
    except StorageError as exc:
        raise RuntimeError(f"Failed to configure storage backend: {exc}") from exc

    app.extensions["storage"] = storage_backend

    @jwt.user_identity_loader
    def _user_identity_lookup(identity):
        """Ensure all JWT subjects are stored as strings."""

        return str(identity) if identity is not None else None

    @jwt.invalid_token_loader
    def _invalid_token_callback(reason: str):
        return jsonify({"msg": "Invalid authentication token"}), 401

    @jwt.unauthorized_loader
    def _unauthorized_callback(reason: str):
        return jsonify({"msg": "Missing authentication token"}), 401

    @jwt.expired_token_loader
    def _expired_token_callback(jwt_header, jwt_payload):
        return jsonify({"msg": "Authentication token has expired"}), 401

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

    @app.before_request
    def _check_auth_and_redirect():
        if request.method == "OPTIONS":
            return None

        path = request.path or "/"

        public_paths = {
            "/",
            "/login",
            "/favicon.ico",
            "/index.html",
            "/api/auth/login",
            "/api/auth/register",
        }
        public_prefixes = (
            "/static/",
            "/assets/",
            "/favicon.",
            "/manifest",
            "/robots",
        )

        if path in public_paths:
            return None

        if path.startswith("/api/"):
            return None

        if path.startswith(public_prefixes):
            return None

        try:
            verify_jwt_in_request()
        except Exception:
            return redirect("/", code=302)

        return None

    @app.route("/LOGIN")
    def _redirect_upper_login():
        """Redirect legacy uppercase login URLs to the SPA root."""

        return redirect("/", code=302)

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_react(path: str):
        if path.startswith("api/") or path.startswith("static/"):
            return jsonify({"error": "Not found"}), 404

        dist_dir = app.static_folder
        if dist_dir and path:
            requested_path = os.path.join(dist_dir, path)
            if os.path.isfile(requested_path):
                return send_from_directory(dist_dir, path)

        try:
            return send_from_directory(app.static_folder, "index.html")
        except FileNotFoundError:
            abort(404)

    @app.errorhandler(TypeError)
    def _handle_type_error(error):
        if str(error) == "Subject must be a string":
            return jsonify({"msg": "Invalid authentication token"}), 401
        raise error

    with app.app_context():
        from models import Attachment, RoleLabel, SiteSetting, Task, TaskUpdate, User  # noqa: F401

        db.create_all()

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
