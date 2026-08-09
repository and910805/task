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


def task_is_accessible(task, role: str | None, user_id: int | None) -> bool:
    """Return whether a user may access a task under the shared ownership rules."""

    if task is None or user_id is None:
        return False
    if role in {"admin", "hq_staff"}:
        return True

    assigned_ids: set[int] = set()
    if getattr(task, "assigned_to_id", None):
        assigned_ids.add(task.assigned_to_id)
    for assignment in (getattr(task, "assignees", None) or []):
        assignment_user_id = getattr(assignment, "user_id", None)
        if assignment_user_id:
            assigned_ids.add(assignment_user_id)

    if role == "worker":
        return user_id in assigned_ids
    if role == "site_supervisor":
        return getattr(task, "assigned_by_id", None) == user_id or user_id in assigned_ids
    return False
