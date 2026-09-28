"""Workspace (tenant) resolution and authorization.

Every authenticated API resolves exactly one workspace per request and checks
the caller's membership and role inside it. Queries must then filter by
``current_workspace_id()``; the frontend is never trusted to filter data.

Views are tagged with a tenancy policy so a test can prove that no API route
was left without a decision:

* ``public``    - no login (login, public booking, webhooks, health)
* ``account``   - login required, but not bound to a workspace (profile, list
                  my workspaces, create a company, accept an invitation)
* ``workspace`` - login and active membership in the resolved workspace
"""

from __future__ import annotations

import json
from datetime import datetime
from functools import wraps

from flask import abort, current_app, g, has_request_context, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from flask_jwt_extended.exceptions import JWTExtendedException
from jwt.exceptions import PyJWTError
from sqlalchemy import event
from sqlalchemy.orm import Session

from extensions import db

POLICY_ATTR = "_tenant_policy"
WORKSPACE_HEADER = "X-Workspace-Id"

# Modules whose queries are not workspace-scoped yet. Until Phase 2 finishes
# them, only the migrated legacy workspace may call them (enforced here, on the
# server, not by hiding menu items).
LEGACY_ONLY_BLUEPRINTS = {"line"}


def _set_policy(fn, policy: str):
    setattr(fn, POLICY_ATTR, policy)
    return fn


def public_endpoint(fn):
    return _set_policy(fn, "public")


def _error(msg: str, status: int, code: str):
    return jsonify({"msg": msg, "code": code}), status


def _load_current_user():
    """Verify the JWT and return the User, or an error response tuple."""
    from models import User

    try:
        verify_jwt_in_request()
    except (JWTExtendedException, PyJWTError, TypeError, ValueError):
        return None, _error("Invalid authentication token", 401, "auth_required")
    try:
        user_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return None, _error("Invalid authentication token", 401, "auth_required")
    user = db.session.get(User, user_id)
    if user is None:
        return None, _error("Invalid authentication token", 401, "auth_required")
    g.current_user = user
    return user, None


def active_memberships(user_id: int):
    from models import Workspace, WorkspaceMember

    return (
        WorkspaceMember.query.join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .filter(
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.status == "active",
            Workspace.status == "active",
        )
        .order_by(
            WorkspaceMember.last_used_at.is_(None),
            WorkspaceMember.last_used_at.desc(),
            WorkspaceMember.joined_at.asc(),
        )
        .all()
    )


def _requested_workspace_id():
    raw = request.headers.get(WORKSPACE_HEADER)
    if raw is None or str(raw).strip() == "":
        return None, None
    try:
        return int(str(raw).strip()), None
    except ValueError:
        return None, _error("Invalid workspace", 400, "workspace_invalid")


def _resolve_membership(user):
    """Pick the membership for this request (header first, then most recent)."""
    requested_id, error = _requested_workspace_id()
    if error:
        return None, error
    memberships = active_memberships(user.id)
    if requested_id is not None:
        for membership in memberships:
            if membership.workspace_id == requested_id:
                return membership, None
        return None, _error("You are not a member of this workspace", 403, "workspace_forbidden")
    if not memberships:
        return None, _error("No workspace yet", 403, "no_workspace")
    return memberships[0], None


def _bind_membership(membership) -> None:
    g.workspace = membership.workspace
    g.membership = membership
    g.workspace_role = membership.role


def workspace_required(*roles: str, legacy_only: bool = False, owner_only: bool = False):
    """Require an active membership; optionally restrict roles (admin always passes)."""

    allowed_roles = (set(roles) | {"admin"}) if roles else None

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user, error = _load_current_user()
            if error:
                return error
            membership, error = _resolve_membership(user)
            if error:
                return error
            _bind_membership(membership)
            workspace = membership.workspace
            if (legacy_only or request.blueprint in LEGACY_ONLY_BLUEPRINTS) and not workspace.is_legacy:
                return _error("This module is not available for this workspace yet", 403, "module_unavailable")
            if allowed_roles is not None and membership.role not in allowed_roles:
                return _error("Insufficient permissions", 403, "role_forbidden")
            if owner_only and workspace.owner_user_id != user.id:
                return _error("Only the workspace owner can do this", 403, "owner_required")
            return fn(*args, **kwargs)

        return _set_policy(wrapper, "workspace")

    return decorator


def account_required(fn):
    """Require a valid login without binding a workspace."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        _user, error = _load_current_user()
        if error:
            return error
        return fn(*args, **kwargs)

    return _set_policy(wrapper, "account")


def try_bind_workspace(user) -> None:
    """Best-effort workspace binding for account-level views (e.g. /auth/me)."""
    membership, error = _resolve_membership(user)
    if membership is not None and error is None:
        _bind_membership(membership)


def current_user():
    return g.get("current_user") if has_request_context() else None


def current_workspace():
    return g.get("workspace") if has_request_context() else None


def current_workspace_id() -> int | None:
    workspace = current_workspace()
    return workspace.id if workspace is not None else None


def current_role() -> str | None:
    return g.get("workspace_role") if has_request_context() else None


def is_workspace_owner() -> bool:
    workspace = current_workspace()
    user = current_user()
    return bool(workspace and user and workspace.owner_user_id == user.id)


def scoped_get_or_404(model, object_id, *, options=None):
    """Load a row of the current workspace; other workspaces' rows are 404."""
    workspace_id = current_workspace_id()
    if workspace_id is None:
        abort(404)
    query = model.query
    if options:
        query = query.options(*options)
    instance = query.filter(model.id == object_id, model.workspace_id == workspace_id).first()
    if instance is None:
        abort(404)
    return instance


def workspace_role_for_user(user_id: int | None, workspace_id: int | None = None) -> str | None:
    """Return a user's role in a workspace (defaults to the request workspace)."""
    if user_id is None or not has_request_context():
        return None
    workspace_id = workspace_id or current_workspace_id()
    if workspace_id is None:
        return None
    cache = g.setdefault("_member_role_cache", {})
    key = (workspace_id, user_id)
    if key not in cache:
        from models import WorkspaceMember

        membership = WorkspaceMember.query.filter_by(workspace_id=workspace_id, user_id=user_id).first()
        cache[key] = membership.role if membership else None
    return cache[key]


ROLE_LABELS_KEY = "role_labels"


def workspace_role_label_overrides(workspace_id: int) -> dict:
    from models import WorkspaceSetting

    raw = WorkspaceSetting.get_value(workspace_id, ROLE_LABELS_KEY)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return {str(k): str(v) for k, v in parsed.items() if str(v).strip()} if isinstance(parsed, dict) else {}


def current_workspace_role_labels() -> dict | None:
    workspace_id = current_workspace_id()
    if workspace_id is None:
        return None
    cache = g.setdefault("_role_label_cache", {})
    if workspace_id not in cache:
        from models import WORKSPACE_ROLE_LABEL_DEFAULTS

        cache[workspace_id] = {**WORKSPACE_ROLE_LABEL_DEFAULTS, **workspace_role_label_overrides(workspace_id)}
    return cache[workspace_id]


def clear_request_caches() -> None:
    if has_request_context():
        g.pop("_role_label_cache", None)
        g.pop("_member_role_cache", None)


def legacy_workspace_id() -> int | None:
    from models import Workspace

    cache = current_app.extensions.setdefault("tenancy", {})
    if cache.get("legacy_id") is None:
        workspace = Workspace.query.filter_by(is_legacy=True).order_by(Workspace.id.asc()).first()
        cache["legacy_id"] = workspace.id if workspace else None
    return cache["legacy_id"]


def _fill_workspace_ids(session, _flush_context, _instances):
    """Stamp new tenant rows with the request workspace.

    Rows of not-yet-scoped legacy modules created without a request workspace
    (public website bookings, LINE) belong to the legacy workspace.
    """
    from models import Task, SiteLocation, Workspace, WorkspaceInvitation, WorkspaceMember, WorkspaceSetting

    skip = (Workspace, WorkspaceMember, WorkspaceInvitation, WorkspaceSetting)
    pending = [
        obj
        for obj in session.new
        if not isinstance(obj, skip) and hasattr(type(obj), "workspace_id") and obj.workspace_id is None
    ]
    if not pending:
        return
    request_workspace_id = current_workspace_id()
    with session.no_autoflush:
        for obj in pending:
            if request_workspace_id is not None:
                obj.workspace_id = request_workspace_id
            elif not isinstance(obj, (Task, SiteLocation)):
                try:
                    obj.workspace_id = legacy_workspace_id()
                except RuntimeError:  # no app context
                    pass


def init_tenancy(app) -> None:
    if not getattr(Session, "_taskgo_tenancy_listener", False):
        event.listen(Session, "before_flush", _fill_workspace_ids)
        Session._taskgo_tenancy_listener = True


def touch_membership(membership) -> None:
    membership.last_used_at = datetime.utcnow()
