from functools import wraps

from flask import jsonify
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from extensions import db
from models import User


ALWAYS_ALLOWED_ROLES = {"admin"}


def jwt_user_claims_are_current(jwt_payload: dict) -> bool:
    try:
        user_id = int(jwt_payload.get("sub"))
    except (TypeError, ValueError):
        return False
    user = db.session.get(User, user_id)
    return user is not None and jwt_payload.get("role") == user.role


def role_required(*roles):
    """Restrict a view to users with any of the given roles.

    The admin role is always allowed.
    """

    allowed_roles = set(roles) | ALWAYS_ALLOWED_ROLES

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                verify_jwt_in_request()
            except (TypeError, ValueError):
                return jsonify({"msg": "Invalid authentication token"}), 401

            try:
                user_id = int(get_jwt_identity())
            except (TypeError, ValueError):
                return jsonify({"msg": "Invalid authentication token"}), 401

            # Resolve the role from the database on every privileged request.
            # A role embedded in an older JWT must not keep admin privileges after
            # the account is demoted or deleted.
            user = db.session.get(User, user_id)
            if user is None:
                return jsonify({"msg": "Invalid authentication token"}), 401
            user_role = user.role
            if user_role not in allowed_roles:
                return jsonify({"msg": "Insufficient permissions"}), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator
