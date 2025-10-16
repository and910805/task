from functools import wraps
from flask import jsonify
from flask_jwt_extended import get_jwt, verify_jwt_in_request


ALWAYS_ALLOWED_ROLES = {"admin"}


def role_required(*roles):
    """Restrict a view to users with any of the given roles.

    The admin role is always allowed.
    """

    allowed_roles = set(roles) | ALWAYS_ALLOWED_ROLES

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            claims = get_jwt() or {}
            user_role = claims.get("role")
            if user_role not in allowed_roles:
                return jsonify({"msg": "Insufficient permissions"}), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator
