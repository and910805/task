import os
from datetime import timedelta

from flask import Flask, abort, jsonify, send_from_directory
from flask_cors import CORS

from extensions import db, jwt


def create_app() -> Flask:
    frontend_dist_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
    )

    app = Flask(__name__, static_folder=frontend_dist_path, static_url_path="/")

    database_path = os.path.join(os.path.dirname(__file__), "task_manager.db")
    uploads_path = os.path.join(os.path.dirname(__file__), "uploads")

    app.config.update(
        SECRET_KEY="super-secret-key",
        SQLALCHEMY_DATABASE_URI=f"sqlite:///{database_path}",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="jwt-secret-key",
        JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=8),
        UPLOAD_FOLDER=uploads_path,
        MAX_CONTENT_LENGTH=16 * 1024 * 1024,
    )

    os.makedirs(uploads_path, exist_ok=True)

    CORS(app)
    db.init_app(app)
    jwt.init_app(app)

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
    from routes.tasks import tasks_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(tasks_bp, url_prefix="/api/tasks")

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path: str):
        if path.startswith("api/"):
            # Allow API blueprints to handle these routes.
            abort(404)

        static_folder = app.static_folder
        if static_folder:
            requested_path = os.path.join(static_folder, path)

            if path and os.path.exists(requested_path):
                return send_from_directory(static_folder, path)

            index_path = os.path.join(static_folder, "index.html")
            if os.path.exists(index_path):
                return send_from_directory(static_folder, "index.html")

        return ("Frontend build not found", 404)

    @app.errorhandler(TypeError)
    def _handle_type_error(error):
        if str(error) == "Subject must be a string":
            return jsonify({"msg": "Invalid authentication token"}), 401
        raise error

    with app.app_context():
        from models import Attachment, Task, TaskUpdate, User  # noqa: F401

        db.create_all()

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
