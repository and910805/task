import os
from datetime import timedelta

from flask import Flask
from flask_cors import CORS

from extensions import db, jwt


def create_app() -> Flask:
    app = Flask(__name__)

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

    from routes.auth import auth_bp
    from routes.tasks import tasks_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(tasks_bp, url_prefix="/api/tasks")

    with app.app_context():
        from models import Attachment, Task, TaskUpdate, User  # noqa: F401

        db.create_all()

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
