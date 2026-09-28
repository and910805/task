import secrets
import json
import os
from datetime import datetime, timedelta

from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import create_access_token

from extensions import db
from sqlalchemy.orm import selectinload

from models import SiteSetting, Task, TaskAssignee, User, WORKSPACE_ROLES, WorkspaceMember

from utils import get_current_user_id
from rate_limit import rate_limit
from tenancy import (
    account_required,
    current_role,
    current_user,
    current_workspace,
    current_workspace_id,
    is_workspace_owner,
    public_endpoint,
    try_bind_workspace,
    workspace_required,
    _load_current_user,
    _resolve_membership,
)

from services.notifications import has_email_config, send_email_async
from services.line_messaging import has_line_config, push_text


VALID_ROLES = set(WORKSPACE_ROLES)
MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 256
MAX_USERNAME_LENGTH = 80

auth_bp = Blueprint("auth", __name__)


def _generate_password() -> str:
    """Return a random password safe for initial credentials."""

    # 12-characters token encoded using URL-safe alphabet (~16 bytes entropy)
    return secrets.token_urlsafe(9)


def _password_error(password: str) -> str | None:
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    if len(password) > MAX_PASSWORD_LENGTH:
        return f"Password must not exceed {MAX_PASSWORD_LENGTH} characters"
    return None


def _current_workspace_admin() -> bool:
    """True when the caller is an admin of the request workspace (binds it)."""
    if not request.headers.get("Authorization"):
        return False
    user, error = _load_current_user()
    if error:
        return False
    membership, error = _resolve_membership(user)
    if error or membership is None:
        return False
    g.workspace = membership.workspace
    g.membership = membership
    g.workspace_role = membership.role
    return membership.role == "admin"


def _public_signup_enabled() -> bool:
    value = (os.getenv("ALLOW_PUBLIC_SIGNUP") or "1").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _normalize_line_id(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
    else:
        value = str(value).strip()
    if not value:
        return None
    if not (value.startswith("U") or value.startswith("@")):
        return None
    return value


def _validate_new_account(data: dict, *, password_required: bool):
    username = (data.get("username") or "").strip()
    password = data.get("password")
    if not username:
        return None, None, "Username and password are required"
    if len(username) > MAX_USERNAME_LENGTH:
        return None, None, f"Username must not exceed {MAX_USERNAME_LENGTH} characters"
    if not password:
        if password_required:
            return None, None, "Username and password are required"
        return username, None, None
    password = str(password)
    password_error = _password_error(password)
    if password_error:
        return None, None, password_error
    if User.query.filter_by(username=username).first():
        return None, None, "Username already exists"
    return username, password, None


def _issue_session(user: User, status: int = 200, **extra):
    from routes.workspaces import session_payload

    try_bind_workspace(user)
    token = create_access_token(identity=str(user.id), additional_claims={"role": user.role})
    payload = session_payload(user)
    payload.update({"token": token, **extra})
    return jsonify(payload), status


@auth_bp.post("/signup")
@public_endpoint
@rate_limit("auth-signup", limit=5, window_seconds=3600)
def signup():
    """Create an account and a new company owned by it."""
    from routes.workspaces import create_workspace_for, validate_workspace_input

    if not _public_signup_enabled():
        return jsonify({"msg": "Public signup is disabled"}), 403
    data = request.get_json(silent=True) or {}
    username, password, error = _validate_new_account(data, password_required=True)
    if error:
        return jsonify({"msg": error}), 400
    company_name, industry, error = validate_workspace_input(data)
    if error:
        return jsonify({"msg": error}), 400
    if not data.get("accept_terms"):
        return jsonify({"msg": "請先同意服務條款與隱私權政策"}), 400

    user = User(username=username, role="worker")
    user.set_password(password)
    db.session.add(user)
    db.session.flush()
    create_workspace_for(user, company_name, industry)
    db.session.commit()
    return _issue_session(user, 201, msg="Account created")


@auth_bp.post("/register")
@public_endpoint
@rate_limit(
    "auth-register",
    limit=5,
    window_seconds=3600,
    bypass=_current_workspace_admin,
)
def register():
    """Workspace admin creates a member account, or an invitee creates one."""
    from routes.workspaces import (
        _plan_allows_another_member, find_usable_invitation, redeem_invitation,
        lock_membership_workspace, invitation_error_response,
    )

    data = request.get_json() or {}
    invite_code = str(data.get("invite_code") or "").strip()
    line_id = _normalize_line_id(data.get("line_id"))
    if data.get("line_id") is not None and not line_id:
        return jsonify({"msg": "LINE ID 格式不正確，需以 U 或 @ 開頭"}), 400

    is_admin = current_workspace() is not None and current_role() == "admin"
    if not is_admin and not invite_code:
        return jsonify({"msg": "Public registration is disabled"}), 403

    if is_admin:
        requested_role = str(data.get("role") or "worker").strip()
        if requested_role not in VALID_ROLES:
            return jsonify({"msg": "Invalid role"}), 400
        if requested_role == "admin" and not is_workspace_owner():
            return jsonify({"msg": "只有擁有者可以新增管理員"}), 403
        workspace = lock_membership_workspace(current_workspace_id())
        if workspace is None:
            db.session.rollback()
            return jsonify({"msg": "公司已停用", "code": "workspace_forbidden"}), 403
        if not _plan_allows_another_member(workspace):
            return jsonify({"msg": "此公司方案的成員數已達上限", "code": "plan_limit"}), 403
        username, password, error = _validate_new_account(data, password_required=False)
        if error:
            return jsonify({"msg": error}), 400
        generated_password = None
        if not password:
            if User.query.filter_by(username=username).first():
                return jsonify({"msg": "Username already exists"}), 400
            password = _generate_password()
            generated_password = password
        user = User(username=username, role="worker")
        user.set_password(password)
        if line_id:
            user.notification_type = "line"
            user.notification_value = line_id
        db.session.add(user)
        db.session.flush()
        db.session.add(
            WorkspaceMember(workspace_id=current_workspace_id(), user_id=user.id, role=requested_role)
        )
        db.session.commit()
        g.pop("_member_role_cache", None)
        response = {"msg": "User created", "user": user.to_dict(), "role": requested_role}
        if generated_password:
            response["generated_password"] = generated_password
        return jsonify(response), 201

    invitation = find_usable_invitation(invite_code)
    if invitation is None:
        return jsonify({"msg": "邀請碼無效或已過期"}), 404
    username, password, error = _validate_new_account(data, password_required=True)
    if error:
        return jsonify({"msg": error}), 400
    user = User(username=username, role="worker")
    user.set_password(password)
    if line_id:
        user.notification_type = "line"
        user.notification_value = line_id
    db.session.add(user)
    db.session.flush()
    _membership, error = redeem_invitation(user, invitation)
    if error:
        db.session.rollback()
        return invitation_error_response(error)
    db.session.commit()
    return _issue_session(user, 201, msg="User created")


@auth_bp.post("/login")
@public_endpoint
@rate_limit(
    "auth-login",
    limit=10,
    window_seconds=300,
    identity=lambda: str((request.get_json(silent=True) or {}).get("username") or ""),
)
def login():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"msg": "Username and password are required"}), 400
    if len(username) > MAX_USERNAME_LENGTH or len(password) > MAX_PASSWORD_LENGTH:
        return jsonify({"msg": "Invalid credentials"}), 401

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({"msg": "Invalid credentials"}), 401

    return _issue_session(user, msg="login success")


@auth_bp.get("/me")
@account_required
def me():
    """Current account; ``role`` is the membership role in the bound workspace."""
    from routes.workspaces import session_payload

    user = current_user()
    try_bind_workspace(user)
    payload = session_payload(user)
    data = dict(payload["user"])
    data["workspaces"] = payload["workspaces"]
    data["active_workspace_id"] = payload["active_workspace_id"]
    return jsonify(data)


@auth_bp.post("/refresh")
@account_required
def refresh():
    return _issue_session(current_user(), msg="token refreshed")


@auth_bp.post("/logout")
@public_endpoint
def logout():
    return jsonify({"msg": "logout success"})


@auth_bp.delete("/account")
@account_required
@rate_limit("auth-delete-account", limit=5, window_seconds=3600)
def delete_own_account():
    """Self-service account deletion (App Store guideline 5.1.1(v))."""
    from routes.workspaces import delete_account, shared_owned_workspaces

    user = current_user()
    data = request.get_json(silent=True) or {}
    password = str(data.get("password") or "")
    if not password or not user.check_password(password):
        return jsonify({"msg": "密碼不正確"}), 400
    blocking = shared_owned_workspaces(user)
    if blocking:
        return (
            jsonify(
                {
                    "msg": "你是以下公司的擁有者，請先轉移擁有權：" + "、".join(w.name for w in blocking),
                    "code": "ownership_transfer_required",
                    "workspaces": [{"id": w.id, "name": w.name} for w in blocking],
                }
            ),
            409,
        )
    delete_account(user)
    db.session.commit()
    return jsonify({"msg": "帳號已刪除"})


def _workspace_member_query():
    return (
        User.query.join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .filter(WorkspaceMember.workspace_id == current_workspace_id(), WorkspaceMember.status == "active")
    )


def _serialize_member(user: User) -> dict:
    workspace = current_workspace()
    data = user.to_dict()
    data["is_owner"] = workspace.owner_user_id == user.id
    data["assigned_tasks"] = [
        {"id": task.id, "title": task.title, "status": task.status}
        for task in user.assigned_tasks
        if task.workspace_id == workspace.id
    ]
    return data


def _get_member_or_404(user_id: int):
    membership = WorkspaceMember.query.filter_by(
        workspace_id=current_workspace_id(), user_id=user_id, status="active"
    ).first()
    if membership is None:
        return None, (jsonify({"msg": "User not found"}), 404)
    return membership, None


@auth_bp.get("/users")
@workspace_required("admin")
def list_users():
    users = _workspace_member_query().options(selectinload(User.assigned_tasks)).order_by(User.username.asc()).all()
    payload = [_serialize_member(user) for user in users]
    return jsonify({"users": payload, "total": len(payload)})


@auth_bp.get("/assignable-users")
@workspace_required("site_supervisor", "hq_staff", "worker")
def list_assignable_users():
    role = current_role()
    workspace = current_workspace()
    query = _workspace_member_query()
    if workspace.is_legacy:
        query = query.filter(WorkspaceMember.role != "admin")
    if role == "worker":
        # Workers can only pick other workers for field-side補派工/工時計算.
        query = query.filter(WorkspaceMember.role == "worker")
    users = query.order_by(User.username.asc()).all()
    return jsonify([user.to_dict() for user in users])


@auth_bp.put("/users/<int:user_id>")
@workspace_required("admin")
def update_user(user_id: int):
    membership, error = _get_member_or_404(user_id)
    if error:
        return error
    workspace = current_workspace()
    data = request.get_json() or {}
    role = data.get("role")
    password = data.get("password")
    target_is_owner = workspace.owner_user_id == user_id

    if role:
        if role not in VALID_ROLES:
            return jsonify({"msg": "Invalid role"}), 400
        if target_is_owner and role != "admin":
            return jsonify({"msg": "擁有者必須是管理員，請先轉移擁有權"}), 400
        if (role == "admin" or membership.role == "admin") and not is_workspace_owner():
            return jsonify({"msg": "只有擁有者可以調整管理員"}), 403
        membership.role = role

    if password:
        # An account can belong to several companies; one company's admin may
        # only reset passwords of accounts that belong to that company alone.
        other_memberships = WorkspaceMember.query.filter(
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.workspace_id != workspace.id,
        ).count()
        if other_memberships or (target_is_owner and not is_workspace_owner()):
            return jsonify({"msg": "此帳號也屬於其他公司，請本人自行變更密碼"}), 403
        password = str(password)
        password_error = _password_error(password)
        if password_error:
            return jsonify({"msg": password_error}), 400
        membership.user.set_password(password)

    db.session.commit()
    g.pop("_member_role_cache", None)
    return jsonify(membership.user.to_dict())


@auth_bp.delete("/users/<int:user_id>")
@workspace_required("admin")
def delete_user(user_id: int):
    """Remove a member from this company; delete the account if it has no other company."""
    from routes.workspaces import _detach_member_from_workspace_tasks, delete_account

    membership, error = _get_member_or_404(user_id)
    if error:
        return error
    workspace = current_workspace()
    if workspace.owner_user_id == user_id:
        return jsonify({"msg": "無法移除擁有者"}), 400
    if user_id == current_user().id:
        return jsonify({"msg": "無法移除自己，請使用「離開公司」"}), 400
    if membership.role == "admin" and not is_workspace_owner():
        return jsonify({"msg": "只有擁有者可以移除管理員"}), 403

    user = membership.user
    _detach_member_from_workspace_tasks(user_id, workspace.id)
    db.session.delete(membership)
    db.session.flush()
    if not WorkspaceMember.query.filter_by(user_id=user_id).count():
        delete_account(user)
    db.session.commit()
    return jsonify({"msg": "User deleted"})


@auth_bp.put("/notification-settings")
@account_required
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

    if "reminder_frequency" in data:
        frequency_raw = data.get("reminder_frequency") or ""
        frequency = frequency_raw.strip().lower() if isinstance(frequency_raw, str) else ""
        if frequency not in {"off", "daily", "weekly"}:
            return jsonify({"msg": "Invalid reminder frequency"}), 400
        user.reminder_frequency = frequency

    db.session.commit()

    return jsonify({"msg": "Notification settings updated", "user": user.to_dict()})

@auth_bp.post("/test-email")
@account_required
def test_email():
    """Send a test email to the current user's configured email address."""
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"msg": "Invalid authentication token"}), 401

    user = User.query.get_or_404(user_id)
    if user.notification_type != "email" or not user.notification_value:
        return jsonify({"msg": "尚未設定 Email 通知（請先在個人資料綁定 Email）"}), 400

    if not has_email_config():
        return jsonify({
            "msg": "SMTP 尚未設定（請在 Zeabur Variables 設 EMAIL_SMTP_HOST / EMAIL_SENDER / EMAIL_SMTP_USERNAME / EMAIL_SMTP_PASSWORD 等）"
        }), 400

    subject = "TaskGo 測試信"
    body = (
        "這是一封測試信，用來確認你的 SMTP 設定可正常寄送。\n\n"
        "如果你有收到這封信，代表 Email 通知功能已啟用 ✅"
    )
    html = (
        "<p>這是一封<strong>測試信</strong>，用來確認你的 SMTP 設定可正常寄送。</p>"
        "<p>如果你有收到這封信，代表 Email 通知功能已啟用 ✅</p>"
    )

    send_email_async(user.notification_value, subject, body, html=html)
    return jsonify({"msg": "Test email queued"})


@auth_bp.post("/change-password")
@account_required
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

    password_error = _password_error(new_password)
    if password_error:
        return jsonify({"msg": password_error}), 400

    user.set_password(new_password)
    db.session.commit()

    return jsonify({"msg": "密碼已更新"})
def _line_bind_key(code: str) -> str:
    return f"line_bind:{code}"


@auth_bp.post("/line/bind-code")
@account_required
def create_line_bind_code():
    """Create a short-lived bind code for LINE bot linking."""
    user_id = get_current_user_id()

    ttl_min_raw = (os.getenv("LINE_BIND_CODE_TTL_MINUTES") or "10").strip()
    try:
        ttl_min = max(1, int(ttl_min_raw))
    except ValueError:
        ttl_min = 10

    code = secrets.token_hex(3).upper()  # 6 chars
    expires_at = datetime.utcnow() + timedelta(minutes=ttl_min)

    SiteSetting.set_value(
        _line_bind_key(code),
        json.dumps(
            {"user_id": user_id, "expires_at": expires_at.isoformat()},
            ensure_ascii=False,
        ),
    )

    return jsonify({"ok": True, "code": code, "expires_at": expires_at.isoformat()})


@auth_bp.post("/line/unbind")
@account_required
def line_unbind():
    """Unbind LINE from the current account."""
    user_id = get_current_user_id()
    user = User.query.get_or_404(user_id)
    user.notification_type = None
    user.notification_value = None
    db.session.commit()
    return jsonify({"ok": True, "msg": "LINE unbound", "user": user.to_dict()})


@auth_bp.post("/test-line")
@account_required
def test_line_push():
    """Send a test LINE push to the bound LINE userId."""
    user_id = get_current_user_id()
    user = User.query.get_or_404(user_id)

    if not has_line_config():
        return jsonify({"ok": False, "msg": "LINE is not configured on server"}), 400

    if user.notification_type != "line" or not (user.notification_value or "").startswith("U"):
        return jsonify({"ok": False, "msg": "LINE not bound yet"}), 400

    push_text(user.notification_value, "✅ 測試通知：LINE 推播正常！")
    return jsonify({"ok": True, "msg": "Test LINE push sent"})
