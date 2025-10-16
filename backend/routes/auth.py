from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)

from decorators import role_required
from extensions import db
from models import User


VALID_ROLES = {"worker", "site_supervisor", "hq_staff", "admin"}

auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/register")
@jwt_required(optional=True)
def register():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    role = data.get("role", "worker")

    if not username or not password:
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

    if user_count > 0 and not is_admin:
        return jsonify({"msg": "Only administrators can create users"}), 403

    if User.query.filter_by(username=username).first():
        return jsonify({"msg": "Username already exists"}), 400

    user = User(username=username, role=role)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    return jsonify({"msg": "User created", "user": user.to_dict()}), 201


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


@auth_bp.get("/users")
@role_required("admin")
def list_users():
    users = User.query.order_by(User.username.asc()).all()
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
    db.session.delete(user)
    db.session.commit()
    return jsonify({"msg": "User deleted"})
