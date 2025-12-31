from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from flask_cors import CORS
import os

db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()

def create_app():
    app = Flask(__name__)
    frontend_url = os.environ.get("FRONTEND_URL")
    if frontend_url:
        CORS(app, origins=[frontend_url])
    else:
        CORS(app)

    # --- 基本設定 ---
    app.config['SECRET_KEY'] = 'supersecretkey'
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///taskgo.db'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['UPLOAD_FOLDER'] = os.path.join(os.getcwd(), 'app', 'static', 'uploads')

    # --- 初始化擴充套件 ---
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    # --- 匯入路由 ---
    from app.routes.auth import auth_bp
    from app.routes.tasks import task_bp
    from app.routes.health import health_bp
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(task_bp, url_prefix="/api/tasks")
    app.register_blueprint(health_bp, url_prefix="/api")

    with app.app_context():
        db.create_all()

    return app
