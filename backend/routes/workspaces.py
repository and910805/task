"""Workspaces (companies): creation, switching, invitations, membership."""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, current_app, g, jsonify, request

from extensions import db
from models import (
    WORKSPACE_PLANS,
    WORKSPACE_ROLE_LABEL_DEFAULTS,
    WORKSPACE_ROLES,
    Attachment,
    DeviceToken,
    Task,
    TaskAssignee,
    TaskUpdate,
    User,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMember,
    WorkspaceSetting,
)
from rate_limit import rate_limit
from storage import StorageError
from tenancy import (
    ROLE_LABELS_KEY,
    account_required,
    active_memberships,
    current_user,
    current_workspace,
    current_workspace_id,
    is_workspace_owner,
    public_endpoint,
    touch_membership,
    try_bind_workspace,
    workspace_required,
    workspace_role_label_overrides,
)

workspaces_bp = Blueprint("workspaces", __name__)

MAX_WORKSPACE_NAME = 120
MAX_OWNED_WORKSPACES = 3
INVITE_TTL_DAYS_MAX = 30
INVITE_MAX_USES_MAX = 50

# Starter labels/templates so a new company sees its own vocabulary on day one.
INDUSTRY_PRESETS = {
    "plumbing_electrical": {
        "label": "水電工程",
        "role_labels": {"worker": "水電師傅"},
        "templates": ["已到場，開始作業。", "已完成配管/配線。", "等待材料中。", "已完工並清潔收尾。"],
    },
    "renovation": {
        "label": "室內裝修",
        "role_labels": {"worker": "施工人員", "site_supervisor": "工地主任"},
        "templates": ["已進場施工。", "今日進度已完成。", "等待其他工班。", "已完工，待客戶驗收。"],
    },
    "cleaning": {
        "label": "清潔服務",
        "role_labels": {"worker": "清潔人員", "site_supervisor": "組長"},
        "templates": ["已抵達現場。", "清潔完成，已拍照。", "客戶不在，稍後再訪。", "已完成並回報。"],
    },
    "repair": {
        "label": "維修服務",
        "role_labels": {"worker": "維修技師"},
        "templates": ["已到場檢測。", "已更換零件。", "需再次到場。", "已修復並測試正常。"],
    },
    "other": {"label": "其他現場服務", "role_labels": {}, "templates": []},
}

LEGACY_MODULES = ("line_settings",)


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()


def _display_name(workspace: Workspace) -> str:
    return WorkspaceSetting.get_value(workspace.id, "branding_name") or workspace.name


def _modules_for(workspace: Workspace) -> dict:
    # Modules not yet workspace-isolated stay limited to the migrated company.
    enabled = bool(workspace.is_legacy)
    return {"crm": True, "materials": True, "reports": True, **{name: enabled for name in LEGACY_MODULES}}


def _serialize_membership(membership: WorkspaceMember) -> dict:
    workspace = membership.workspace
    labels = {**WORKSPACE_ROLE_LABEL_DEFAULTS, **workspace_role_label_overrides(workspace.id)}
    return {
        "id": workspace.id,
        "name": _display_name(workspace),
        "legal_name": workspace.name,
        "industry": workspace.industry,
        "plan": workspace.plan,
        "role": membership.role,
        "role_label": "擁有者" if membership.is_owner else labels.get(membership.role, membership.role),
        "is_owner": membership.is_owner,
        "modules": _modules_for(workspace),
    }


def session_payload(user: User) -> dict:
    """User + memberships, with ``user.role`` reflecting the bound workspace."""
    memberships = active_memberships(user.id)
    workspace = current_workspace()
    user_data = user.to_dict()
    if workspace is None:
        user_data["role"] = None
        user_data["role_label"] = None
    user_data["is_owner"] = bool(workspace and workspace.owner_user_id == user.id)
    return {
        "user": user_data,
        "workspaces": [_serialize_membership(item) for item in memberships],
        "active_workspace_id": workspace.id if workspace else None,
    }


def _plan_allows_another_member(workspace: Workspace) -> bool:
    limit = workspace.plan_limits().get("max_members")
    if limit is None:
        return True
    count = WorkspaceMember.query.filter_by(workspace_id=workspace.id, status="active").count()
    return count < limit


INVITATION_UNAVAILABLE = "邀請碼無效或已過期"


def lock_membership_workspace(workspace_id: int) -> Workspace | None:
    # A no-op UPDATE serializes admissions on PostgreSQL and SQLite alike.
    # Hold the write lock until the caller commits membership and invite usage.
    updated = Workspace.query.filter_by(id=workspace_id, status="active").update(
        {"id": Workspace.id, "updated_at": Workspace.updated_at}, synchronize_session=False
    )
    if not updated:
        return None
    return Workspace.query.filter_by(id=workspace_id).populate_existing().one()


def invitation_error_response(error: str):
    if error == INVITATION_UNAVAILABLE:
        return jsonify({"msg": error}), 404
    return jsonify({"msg": error, "code": "plan_limit"}), 403


def _unique_slug() -> str:
    while True:
        slug = f"ws-{secrets.token_hex(4)}"
        if not Workspace.query.filter_by(slug=slug).first():
            return slug


def create_workspace_for(user: User, name: str, industry: str | None) -> Workspace:
    """Create a company owned by ``user`` (caller commits)."""
    preset = INDUSTRY_PRESETS.get(industry or "other", INDUSTRY_PRESETS["other"])
    workspace = Workspace(
        name=name,
        slug=_unique_slug(),
        industry=industry if industry in INDUSTRY_PRESETS else "other",
        owner_user_id=user.id,
        plan="trial",
        status="active",
        is_legacy=False,
    )
    db.session.add(workspace)
    db.session.flush()
    db.session.add(
        WorkspaceMember(
            workspace_id=workspace.id,
            user_id=user.id,
            role="admin",
            status="active",
            last_used_at=datetime.utcnow(),
        )
    )
    if preset["role_labels"]:
        db.session.add(
            WorkspaceSetting(
                workspace_id=workspace.id,
                key=ROLE_LABELS_KEY,
                value=json.dumps(preset["role_labels"], ensure_ascii=False),
            )
        )
    if preset["templates"]:
        db.session.add(
            WorkspaceSetting(
                workspace_id=workspace.id,
                key="task_update_note_templates",
                value=json.dumps(preset["templates"], ensure_ascii=False),
            )
        )
    return workspace


def validate_workspace_input(data: dict) -> tuple[str | None, str | None, str | None]:
    name = str(data.get("name") or data.get("company_name") or "").strip()
    industry = str(data.get("industry") or "other").strip()
    if not name:
        return None, None, "請輸入公司名稱"
    if len(name) > MAX_WORKSPACE_NAME:
        return None, None, "公司名稱過長"
    if industry not in INDUSTRY_PRESETS:
        industry = "other"
    return name, industry, None


def find_usable_invitation(code: str) -> WorkspaceInvitation | None:
    if not code or len(code) > 64:
        return None
    invitation = WorkspaceInvitation.query.filter_by(code_hash=_hash_code(code)).first()
    if invitation is None or not invitation.is_usable():
        return None
    if invitation.workspace is None or invitation.workspace.status != "active":
        return None
    return invitation


def redeem_invitation(user: User, invitation: WorkspaceInvitation) -> tuple[WorkspaceMember | None, str | None]:
    """Add ``user`` to the invitation's workspace (caller commits)."""
    workspace = lock_membership_workspace(invitation.workspace_id)
    if workspace is None:
        return None, INVITATION_UNAVAILABLE
    invitation = WorkspaceInvitation.query.filter_by(id=invitation.id).populate_existing().first()
    if invitation is None or not invitation.is_usable():
        return None, INVITATION_UNAVAILABLE
    existing = WorkspaceMember.query.filter_by(workspace_id=workspace.id, user_id=user.id).populate_existing().first()
    if existing is not None and existing.status == "active":
        return existing, None
    if not _plan_allows_another_member(workspace):
        return None, "此公司方案的成員數已達上限"
    claimed = WorkspaceInvitation.query.filter(
        WorkspaceInvitation.id == invitation.id,
        WorkspaceInvitation.revoked_at.is_(None),
        WorkspaceInvitation.expires_at > datetime.utcnow(),
        WorkspaceInvitation.used_count < WorkspaceInvitation.max_uses,
    ).update({"used_count": WorkspaceInvitation.used_count + 1}, synchronize_session=False)
    if claimed != 1:
        return None, INVITATION_UNAVAILABLE
    db.session.expire(invitation)
    if existing is not None:
        existing.status = "active"
        existing.role = invitation.role
        membership = existing
    else:
        membership = WorkspaceMember(
            workspace_id=invitation.workspace_id,
            user_id=user.id,
            role=invitation.role,
            status="active",
        )
        db.session.add(membership)
    touch_membership(membership)
    return membership, None


# ---------------------------------------------------------------------------
# Account-level: my workspaces, create, switch, join
# ---------------------------------------------------------------------------


@workspaces_bp.get("/")
@account_required
def list_my_workspaces():
    user = current_user()
    try_bind_workspace(user)
    return jsonify(session_payload(user))


@workspaces_bp.post("/")
@account_required
@rate_limit("workspace-create", limit=5, window_seconds=3600)
def create_workspace():
    user = current_user()
    name, industry, error = validate_workspace_input(request.get_json(silent=True) or {})
    if error:
        return jsonify({"msg": error}), 400
    owned = Workspace.query.filter_by(owner_user_id=user.id, status="active").count()
    if owned >= MAX_OWNED_WORKSPACES:
        return jsonify({"msg": f"每個帳號最多可建立 {MAX_OWNED_WORKSPACES} 間公司"}), 400
    workspace = create_workspace_for(user, name, industry)
    db.session.commit()
    g.workspace = workspace
    g.workspace_role = "admin"
    payload = session_payload(user)
    return jsonify(payload), 201


@workspaces_bp.post("/<int:workspace_id>/activate")
@account_required
def activate_workspace(workspace_id: int):
    user = current_user()
    membership = next((m for m in active_memberships(user.id) if m.workspace_id == workspace_id), None)
    if membership is None:
        return jsonify({"msg": "You are not a member of this workspace", "code": "workspace_forbidden"}), 403
    touch_membership(membership)
    db.session.commit()
    g.workspace = membership.workspace
    g.membership = membership
    g.workspace_role = membership.role
    return jsonify(session_payload(user))


@workspaces_bp.get("/invitations/preview")
@public_endpoint
@rate_limit("invite-preview", limit=30, window_seconds=600)
def preview_invitation():
    invitation = find_usable_invitation(str(request.args.get("code") or ""))
    if invitation is None:
        return jsonify({"msg": "邀請碼無效或已過期"}), 404
    labels = {**WORKSPACE_ROLE_LABEL_DEFAULTS, **workspace_role_label_overrides(invitation.workspace_id)}
    return jsonify(
        {
            "workspace_name": _display_name(invitation.workspace),
            "role": invitation.role,
            "role_label": labels.get(invitation.role, invitation.role),
            "expires_at": invitation.expires_at.isoformat(),
        }
    )


@workspaces_bp.post("/join")
@account_required
@rate_limit("invite-join", limit=10, window_seconds=600)
def join_workspace():
    user = current_user()
    invitation = find_usable_invitation(str((request.get_json(silent=True) or {}).get("code") or ""))
    if invitation is None:
        return jsonify({"msg": "邀請碼無效或已過期"}), 404
    membership, error = redeem_invitation(user, invitation)
    if error:
        db.session.rollback()
        return invitation_error_response(error)
    db.session.commit()
    g.workspace = membership.workspace
    g.membership = membership
    g.workspace_role = membership.role
    return jsonify(session_payload(user))


# ---------------------------------------------------------------------------
# Current workspace
# ---------------------------------------------------------------------------


@workspaces_bp.get("/current")
@workspace_required()
def get_current_workspace():
    workspace = current_workspace()
    data = workspace.to_dict()
    data["display_name"] = _display_name(workspace)
    data["member_count"] = WorkspaceMember.query.filter_by(workspace_id=workspace.id, status="active").count()
    data["modules"] = _modules_for(workspace)
    data["industries"] = {key: value["label"] for key, value in INDUSTRY_PRESETS.items()}
    data["plans"] = {key: value["label"] for key, value in WORKSPACE_PLANS.items()}
    data["is_owner"] = is_workspace_owner()
    return jsonify(data)


@workspaces_bp.put("/current")
@workspace_required("admin")
def update_current_workspace():
    workspace = current_workspace()
    data = request.get_json(silent=True) or {}
    if "name" in data:
        name, _industry, error = validate_workspace_input({"name": data.get("name")})
        if error:
            return jsonify({"msg": error}), 400
        workspace.name = name
    if "industry" in data:
        industry = str(data.get("industry") or "").strip()
        if industry not in INDUSTRY_PRESETS:
            return jsonify({"msg": "未知的產業類型"}), 400
        workspace.industry = industry
    db.session.commit()
    return get_current_workspace()


@workspaces_bp.post("/current/leave")
@workspace_required()
def leave_current_workspace():
    if is_workspace_owner():
        return jsonify({"msg": "擁有者需先轉移擁有權才能離開公司"}), 400
    membership = g.membership
    _detach_member_from_workspace_tasks(membership.user_id, membership.workspace_id)
    db.session.delete(membership)
    db.session.commit()
    return jsonify({"msg": "已離開公司"})


@workspaces_bp.post("/current/transfer-ownership")
@workspace_required("admin", owner_only=True)
def transfer_ownership():
    workspace = current_workspace()
    try:
        target_id = int((request.get_json(silent=True) or {}).get("user_id"))
    except (TypeError, ValueError):
        return jsonify({"msg": "user_id is required"}), 400
    target = WorkspaceMember.query.filter_by(workspace_id=workspace.id, user_id=target_id, status="active").first()
    if target is None:
        return jsonify({"msg": "找不到此成員"}), 404
    target.role = "admin"
    workspace.owner_user_id = target_id
    db.session.commit()
    return jsonify({"msg": "已轉移擁有權", "owner_user_id": target_id})


# ---------------------------------------------------------------------------
# Invitations
# ---------------------------------------------------------------------------


@workspaces_bp.get("/current/invitations")
@workspace_required("admin")
def list_invitations():
    invitations = (
        WorkspaceInvitation.query.filter_by(workspace_id=current_workspace_id())
        .order_by(WorkspaceInvitation.created_at.desc())
        .limit(100)
        .all()
    )
    return jsonify({"invitations": [item.to_dict() for item in invitations]})


@workspaces_bp.post("/current/invitations")
@workspace_required("admin")
def create_invitation():
    data = request.get_json(silent=True) or {}
    role = str(data.get("role") or "worker").strip()
    if role not in WORKSPACE_ROLES:
        return jsonify({"msg": "Invalid role"}), 400
    if role == "admin" and not is_workspace_owner():
        return jsonify({"msg": "只有擁有者可以邀請管理員"}), 403
    try:
        days = int(data.get("expires_in_days") or 7)
        max_uses = int(data.get("max_uses") or 1)
    except (TypeError, ValueError):
        return jsonify({"msg": "Invalid invitation settings"}), 400
    days = max(1, min(days, INVITE_TTL_DAYS_MAX))
    max_uses = max(1, min(max_uses, INVITE_MAX_USES_MAX))
    label = str(data.get("label") or "").strip()[:120] or None

    code = secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:10].upper()
    invitation = WorkspaceInvitation(
        workspace_id=current_workspace_id(),
        code_hash=_hash_code(code),
        code_hint=code[-4:],
        role=role,
        label=label,
        invited_by_id=current_user().id,
        expires_at=datetime.utcnow() + timedelta(days=days),
        max_uses=max_uses,
    )
    db.session.add(invitation)
    db.session.commit()
    payload = invitation.to_dict()
    # The plain code is shown exactly once; only its hash is stored.
    payload["code"] = code
    return jsonify(payload), 201


@workspaces_bp.delete("/current/invitations/<int:invitation_id>")
@workspace_required("admin")
def revoke_invitation(invitation_id: int):
    invitation = WorkspaceInvitation.query.filter_by(
        id=invitation_id, workspace_id=current_workspace_id()
    ).first()
    if invitation is None:
        return jsonify({"msg": "Not found"}), 404
    if invitation.revoked_at is None:
        invitation.revoked_at = datetime.utcnow()
        db.session.commit()
    return jsonify(invitation.to_dict())


# ---------------------------------------------------------------------------
# Members (the Admin page's user list uses /api/auth/users, which calls these)
# ---------------------------------------------------------------------------


def _detach_member_from_workspace_tasks(user_id: int, workspace_id: int) -> None:
    task_ids = [task_id for (task_id,) in db.session.query(Task.id).filter(Task.workspace_id == workspace_id).all()]
    if not task_ids:
        return
    Task.query.filter(Task.id.in_(task_ids), Task.assigned_to_id == user_id).update(
        {"assigned_to_id": None}, synchronize_session=False
    )
    TaskAssignee.query.filter(TaskAssignee.task_id.in_(task_ids), TaskAssignee.user_id == user_id).delete(
        synchronize_session=False
    )


def delete_account(user: User) -> None:
    from services.account_deletion import delete_account as delete_account_records

    delete_account_records(user)


def shared_owned_workspaces(user: User) -> list[Workspace]:
    """Companies owned by ``user`` that still have other active members."""
    result = []
    for workspace in Workspace.query.filter_by(owner_user_id=user.id, status="active").all():
        others = (
            WorkspaceMember.query.filter(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.user_id != user.id,
                WorkspaceMember.status == "active",
            ).count()
        )
        if others:
            result.append(workspace)
    return result


@workspaces_bp.get("/push-status")
@account_required
def push_status():
    """Lets the app avoid promising push notifications the server cannot send."""
    from services.push import apns_configured

    return jsonify({"configured": apns_configured()})


@workspaces_bp.post("/devices")
@account_required
def register_device():
    """Store an APNs device token for push notifications (Phase 3)."""
    data = request.get_json(silent=True) or {}
    token = str(data.get("token") or "").strip()
    platform = str(data.get("platform") or "ios").strip().lower()
    if not token or len(token) > 255 or platform not in {"ios", "android"}:
        return jsonify({"msg": "Invalid device token"}), 400
    record = DeviceToken.query.filter_by(token=token).first()
    if record is None:
        record = DeviceToken(token=token, platform=platform, user_id=current_user().id)
        db.session.add(record)
    else:
        # A device that changes hands must stop receiving the previous user's pushes.
        record.user_id = current_user().id
        record.platform = platform
    record.last_seen_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"ok": True})


@workspaces_bp.delete("/devices")
@account_required
def unregister_device():
    token = str((request.get_json(silent=True) or {}).get("token") or "").strip()
    if token:
        DeviceToken.query.filter_by(token=token, user_id=current_user().id).delete(synchronize_session=False)
        db.session.commit()
    return jsonify({"ok": True})
