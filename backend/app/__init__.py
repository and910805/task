from flask import Flask, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from flask_cors import CORS
import os

db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()


def create_app():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    dist_dir = os.path.join(root_dir, "frontend", "dist")
    has_frontend = os.path.exists(os.path.join(dist_dir, "index.html"))

    if has_frontend:
        app = Flask(__name__, static_folder=dist_dir, static_url_path="/")
    else:
        app = Flask(__name__)

    frontend_url = os.environ.get("FRONTEND_URL")
    if frontend_url:
        CORS(app, origins=[frontend_url])
    else:
        CORS(app)

    database_url = os.environ.get("DATABASE_URL") or "sqlite:///taskgo.db"
    upload_dir = os.path.join(root_dir, "backend", "instance", "uploads")
    os.makedirs(upload_dir, exist_ok=True)

    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change-me")
    app.config["JWT_SECRET_KEY"] = os.environ.get("JWT_SECRET_KEY", app.config["SECRET_KEY"])
    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["UPLOAD_FOLDER"] = upload_dir

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    from app.routes.auth import auth_bp
    from app.routes.tasks import task_bp
    from app.routes.health import health_bp
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(task_bp, url_prefix="/api/tasks")
    app.register_blueprint(health_bp, url_prefix="/api")

    if has_frontend:
        @app.route("/", defaults={"path": ""})
        @app.route("/<path:path>")
        def serve_frontend(path):
            if path.startswith("api/"):
                return jsonify({"error": "Not found"}), 404
            file_path = os.path.join(dist_dir, path)
            if path and os.path.exists(file_path):
                return send_from_directory(dist_dir, path)
            return send_from_directory(dist_dir, "index.html")

    with app.app_context():
        db.create_all()

    return app
