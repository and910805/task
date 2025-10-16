from __future__ import annotations

from typing import Optional

from flask_jwt_extended import get_jwt_identity


def get_current_user_id() -> Optional[int]:
    """Return the current JWT identity coerced to an integer if possible."""

    identity = get_jwt_identity()
    if identity is None:
        return None

    try:
        return int(identity)
    except (TypeError, ValueError):
        return None
