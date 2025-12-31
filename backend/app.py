import sys, os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from datetime import timedelta

from flask import Flask, abort, jsonify, redirect, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import verify_jwt_in_request

from extensions import db, jwt
from storage import create_storage, StorageError


def create_app() -> Flask:
    # 1. 取得基本目錄資訊
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 2. 先定義 uploads_path (這行必須在 database_path 之前，才不會報錯)
    uploads_path = os.path.join(base_dir, "uploads")
    
    # 3. 將資料庫路徑設在 uploads 資料夾內，確保 Volume 可以持久化保存它
    database_path = os.path.join(uploads_path, "task_manager.db")

    # 前端 dist 目錄位置
    frontend_dist_path = os.path.abspath(
        os.path.join(base_dir, "..", "frontend", "dist")
    )

    # 建立 Flask app，靜態資源目錄指向 React build 結果
    app = Flask(__name__, static_folder=frontend_dist_path, static_url_path="/")

    # 定義其他子資料夾路徑
    reports_path = os.path.join(uploads_path, "reports")
    images_path = os.path.join(uploads_path, "images")
    audio_path = os.path.join(uploads_path, "audio")
    signature_path = os.path.join(uploads_path, "signature")
    other_path = os.path.join(uploads_path, "other")

    # 基本設定
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

    # 確保所有上傳資料夾存在
    for folder in (
        uploads_path,
        reports_path,
        images_path,
        audio_path,
        signature_path,
        other_path,
    ):
        os.makedirs(folder, exist_ok=True)

    # 啟用 CORS / JWT / 資料庫
    CORS(app, supports_credentials=True)
    db.init_app(app)
    jwt.init_app(app)

    # 初始化 Storage
    try:
        storage_backend = create_storage(app.config)
    except StorageError as exc:
        raise RuntimeError(f"Failed to configure storage backend: {exc}") from exc

    app.extensions["storage"] = storage_backend

    # === JWT 錯誤處理 ===
    @jwt.user_identity_loader
    def _user_identity_lookup(identity):
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

    # === Blueprint 註冊 ===
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

    # === Before Request：JWT 驗證 ===
    @app.before_request
    def _check_auth_and_redirect():
        if request.method == "OPTIONS":
            return None

        path = request.path or "/"

        # 可公開訪問的路徑
        public_paths = {
            "/", "/login", "/favicon.ico", "/index.html",
            "/api/auth/login", "/api/auth/register",
        }
        public_prefixes = (
            "/static/", "/assets/", "/favicon.", "/manifest", "/robots",
        )

        if path in public_paths or path.startswith(public_prefixes) or path.startswith("/api/"):
            return None

        try:
            verify_jwt_in_request()
        except Exception:
            # 未登入者自動導回 React 登入首頁
            return redirect("/", code=302)

        return None

    # === React Router fallback：處理重新整理 404 問題 ===
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_react(path: str):
        # 排除 API 或明確的靜態資源請求
        if path.startswith(("api/", "uploads/", "static/", "favicon.", "manifest", "robots")):
            return jsonify({"error": "Not found"}), 404

        dist_dir = app.static_folder
        requested_path = os.path.join(dist_dir, path)

        # 若對應到實際檔案（JS/CSS），直接傳回
        if os.path.exists(requested_path) and not os.path.isdir(requested_path):
            return send_from_directory(dist_dir, path)

        # 其他路由交給 React Router 控制
        return send_from_directory(dist_dir, "index.html")

    # === TypeError 處理 ===
    @app.errorhandler(TypeError)
    def _handle_type_error(error):
        if str(error) == "Subject must be a string":
            return jsonify({"msg": "Invalid authentication token"}), 401
        raise error

    # === 資料庫自動初始化 ===
    with app.app_context():
        # 確保 Model 已載入才進行 create_all
        from models import Attachment, RoleLabel, SiteSetting, Task, TaskUpdate, User  # noqa: F401
        db.create_all()

    return app


# 建立 Flask 應用實例
app = create_app()

if __name__ == "__main__":
    # 允許外部連線，預設 5000 埠號
    app.run(host="0.0.0.0", port=5000, debug=True)