from extensions import db
from models import User
from tenancy import workspace_required


ALWAYS_ALLOWED_ROLES = {"admin"}


def jwt_user_claims_are_current(jwt_payload: dict) -> bool:
    try:
        user_id = int(jwt_payload.get("sub"))
    except (TypeError, ValueError):
        return False
    user = db.session.get(User, user_id)
    return user is not None and jwt_payload.get("role") == user.role


def role_required(*roles):
    """Restrict a view to members of the request workspace with any of the given roles.

    The role is the caller's membership role in the resolved workspace, read
    from the database on every request, so demotion or removal takes effect
    immediately. The admin role is always allowed.
    """

    return workspace_required(*roles)
