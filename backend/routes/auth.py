import secrets

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)

from decorators import role_required
from extensions import db
from sqlalchemy.orm import selectinload

from models import Attachment, Task, TaskUpdate, User


VALID_ROLES = {"worker", "site_supervisor", "hq_staff", "admin"}

auth_bp = Blueprint("auth", __name__)


def _generate_password() -> str:
    """Return a random password safe for initial credentials."""

    # 12-characters token encoded using URL-safe alphabet (~16 bytes entropy)
    return secrets.token_urlsafe(9)


@auth_bp.post("/register")
@jwt_required(optional=True)
def register():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password")
    role = data.get("role", "worker")

    if not username:
        return jsonify({"msg": "Username and password are required"}), 400

    if role not in VALID_ROLES:
        return jsonify({"msg": "Invalid role"}), 400

    user_count = User.query.count()
    current_role = None
    current_user_id = get_jwt_identity()
    if current_user_id:
        claims = get_jwt()
        current_role = claims.get("role")
    is_admin = current_role == "admin"

    is_initial_setup = user_count == 0

    if not is_initial_setup and not is_admin and role != "worker":
        return (
            jsonify({"msg": "僅管理員可建立此角色"}),
            403,
        )

    if not is_initial_setup and not is_admin:
        role = "worker"

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

    response = {"msg": "User created", "user": user.to_dict()}
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
    token = create_access_token(identity=user.id, additional_claims=additional_claims)

    return jsonify({"token": token, "user": user.to_dict()})


@auth_bp.get("/me")
@jwt_required()
def me():
    user_id = get_jwt_identity()
    user = User.query.get_or_404(user_id)
    return jsonify(user.to_dict())


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
    users = (
        User.query.options(selectinload(User.assigned_tasks))
        .order_by(User.username.asc())
        .all()
    )
    return jsonify([_serialize_user_with_tasks(user) for user in users])


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
    TaskUpdate.query.filter_by(user_id=user.id).update(
        {"user_id": None}, synchronize_session=False
    )
    Attachment.query.filter_by(uploaded_by_id=user.id).update(
        {"uploaded_by_id": None}, synchronize_session=False
    )
    db.session.delete(user)
    db.session.commit()
    return jsonify({"msg": "User deleted"})


@auth_bp.post("/change-password")
@jwt_required()
def change_password():
    user_id = get_jwt_identity()
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
