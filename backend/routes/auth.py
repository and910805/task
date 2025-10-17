import secrets

from flask import Blueprint, current_app, jsonify, make_response, request
from flask_jwt_extended import (
    create_access_token,
    get_jwt,
    jwt_required,
)

from decorators import role_required
from extensions import db
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import selectinload

from models import Attachment, Task, TaskAssignee, TaskUpdate, User
from utils import get_current_user_id


VALID_ROLES = {"worker", "site_supervisor", "hq_staff", "admin"}

auth_bp = Blueprint("auth", __name__)


def _generate_password() -> str:
    """Return a random password safe for initial credentials."""

    # 12-characters token encoded using URL-safe alphabet (~16 bytes entropy)
    return secrets.token_urlsafe(9)


def _set_access_cookie(response, token: str):
    """Attach the JWT to the response using an HttpOnly cookie."""

    config = current_app.config
    cookie_name = config.get("JWT_ACCESS_COOKIE_NAME", "access_token")
    secure = config.get("JWT_COOKIE_SECURE", False)
    samesite = config.get("JWT_COOKIE_SAMESITE", "Lax")
    expires = config.get("JWT_ACCESS_TOKEN_EXPIRES")
    max_age = None

    if hasattr(expires, "total_seconds"):
        max_age = int(expires.total_seconds())

    response.set_cookie(
        cookie_name,
        token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=max_age,
        path="/",
    )
    return response


def _clear_access_cookie(response):
    cookie_name = current_app.config.get("JWT_ACCESS_COOKIE_NAME", "access_token")
    response.delete_cookie(cookie_name, path="/")
    return response


@auth_bp.post("/register")
@jwt_required(optional=True)
def register():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password")
    requested_role_raw = data.get("role", "worker")
    requested_role = (
        requested_role_raw.strip()
        if isinstance(requested_role_raw, str)
        else str(requested_role_raw or "worker")
    )

    if not username:
        return jsonify({"msg": "Username and password are required"}), 400

    if requested_role not in VALID_ROLES:
        return jsonify({"msg": "Invalid role"}), 400

    user_count = User.query.count()
    is_initial_setup = user_count == 0

    try:
        claims = get_jwt() or {}
    except RuntimeError:
        claims = {}
    current_role = claims.get("role")
    is_admin = current_role == "admin"

    role = requested_role if is_admin else "worker"

    generated_password = None

    if not password:
        if role == "worker" and not (is_admin or is_initial_setup):
            return jsonify({"msg": "Username and password are required"}), 400
        password = _generate_password()
        generated_password = password

    if User.query.filter_by(username=username).first():
        return jsonify({"msg": "Username already exists"}), 400

    user = User(username=username, role=role)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    response = {"msg": "User created", "user": user.to_dict(), "role": user.role}
    if generated_password:
        response["generated_password"] = generated_password

    return jsonify(response), 201


@auth_bp.post("/login")
def login():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"msg": "Username and password are required"}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({"msg": "Invalid credentials"}), 401

    additional_claims = {"role": user.role}
    token = create_access_token(identity=str(user.id), additional_claims=additional_claims)

    response = make_response(
        jsonify({"msg": "login success", "user": user.to_dict()})
    )
    _set_access_cookie(response, token)
    return response


@auth_bp.get("/me")
@jwt_required()
def me():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"msg": "Invalid authentication token"}), 401

    user = User.query.get_or_404(user_id)
    return jsonify(user.to_dict())


@auth_bp.post("/refresh")
@jwt_required()
def refresh():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"msg": "Invalid authentication token"}), 401

    user = User.query.get(user_id)
    if user is None:
        response = make_response(jsonify({"msg": "User not found"}), 404)
        _clear_access_cookie(response)
        return response
    additional_claims = {"role": user.role}
    token = create_access_token(identity=str(user.id), additional_claims=additional_claims)

    response = make_response(
        jsonify({"msg": "token refreshed", "user": user.to_dict()})
    )
    _set_access_cookie(response, token)
    return response


@auth_bp.post("/logout")
@jwt_required(optional=True)
def logout():
    response = make_response(jsonify({"msg": "logout success"}))
    _clear_access_cookie(response)
    return response


def _serialize_user_with_tasks(user: User) -> dict:
    data = user.to_dict()
    data["assigned_tasks"] = [
        {"id": task.id, "title": task.title, "status": task.status}
        for task in user.assigned_tasks
    ]
    return data


@auth_bp.get("/users")
@role_required("admin")
def list_users():
    try:
        users = (
            User.query.options(selectinload(User.assigned_tasks))
            .order_by(User.username.asc())
            .all()
        )
        payload = [_serialize_user_with_tasks(user) for user in users]
    except OperationalError:
        db.session.rollback()
        users = User.query.order_by(User.username.asc()).all()
        payload = [user.to_dict() | {"assigned_tasks": []} for user in users]
    return jsonify({"users": payload, "total": len(payload)})


@auth_bp.get("/assignable-users")
@role_required("site_supervisor", "hq_staff")
def list_assignable_users():
    users = (
        User.query.filter(User.role != "admin")
        .order_by(User.username.asc())
        .all()
    )
    return jsonify([user.to_dict() for user in users])


@auth_bp.put("/users/<int:user_id>")
@role_required("admin")
def update_user(user_id: int):
    user = User.query.get_or_404(user_id)
    data = request.get_json() or {}

    role = data.get("role")
    password = data.get("password")

    if role:
        if role not in VALID_ROLES:
            return jsonify({"msg": "Invalid role"}), 400
        user.role = role

    if password:
        user.set_password(password)

    db.session.commit()
    return jsonify(user.to_dict())


@auth_bp.delete("/users/<int:user_id>")
@role_required("admin")
def delete_user(user_id: int):
    user = User.query.get_or_404(user_id)
    Task.query.filter_by(assigned_to_id=user.id).update(
        {"assigned_to_id": None}, synchronize_session=False
    )
    Task.query.filter_by(assigned_by_id=user.id).update(
        {"assigned_by_id": None}, synchronize_session=False
    )
    TaskAssignee.query.filter_by(user_id=user.id).delete(synchronize_session=False)
    TaskUpdate.query.filter_by(user_id=user.id).update(
        {"user_id": None}, synchronize_session=False
    )
    Attachment.query.filter_by(uploaded_by_id=user.id).update(
        {"uploaded_by_id": None}, synchronize_session=False
    )
    db.session.delete(user)
    db.session.commit()
    return jsonify({"msg": "User deleted"})


@auth_bp.put("/notification-settings")
@jwt_required()
def update_notification_settings():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"msg": "Invalid authentication token"}), 401

    user = User.query.get_or_404(user_id)
    data = request.get_json() or {}

    notification_type_raw = data.get("notification_type") or "none"
    notification_type = (
        notification_type_raw.strip().lower()
        if isinstance(notification_type_raw, str)
        else "none"
    )

    if notification_type not in {"none", "email", "line"}:
        return jsonify({"msg": "Invalid notification type"}), 400

    value_raw = data.get("notification_value") or ""
    value = value_raw.strip() if isinstance(value_raw, str) else ""

    if notification_type == "none":
        user.notification_type = None
        user.notification_value = None
    elif notification_type == "email":
        if not value or "@" not in value:
            return jsonify({"msg": "請提供有效的 Email"}), 400
        user.notification_type = "email"
        user.notification_value = value
    else:  # line
        if len(value) < 10:
            return jsonify({"msg": "LINE Notify Token 長度不足"}), 400
        user.notification_type = "line"
        user.notification_value = value

    db.session.commit()

    return jsonify({"msg": "Notification settings updated", "user": user.to_dict()})


@auth_bp.post("/change-password")
@jwt_required()
def change_password():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"msg": "Invalid authentication token"}), 401

    user = User.query.get_or_404(user_id)

    data = request.get_json() or {}
    current_password = (data.get("current_password") or "").strip()
    new_password = (data.get("new_password") or "").strip()
    confirm_password = (data.get("confirm_password") or "").strip()

    if not current_password or not new_password or not confirm_password:
        return jsonify({"msg": "請完整填寫密碼欄位"}), 400

    if not user.check_password(current_password):
        return jsonify({"msg": "舊密碼不正確"}), 400

    if new_password != confirm_password:
        return jsonify({"msg": "新密碼與確認密碼不一致"}), 400

    if current_password == new_password:
        return jsonify({"msg": "新密碼不可與舊密碼相同"}), 400

    user.set_password(new_password)
    db.session.commit()

    return jsonify({"msg": "密碼已更新"})
