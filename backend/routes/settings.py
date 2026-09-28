import json
import os
import re
import uuid

from flask import Blueprint, current_app, jsonify, redirect, request, send_from_directory, url_for

from models import WORKSPACE_ROLE_LABEL_DEFAULTS, WorkspaceSetting
from services.attachments import validate_upload_content
from storage import StorageError
from tenancy import (
    ROLE_LABELS_KEY,
    clear_request_caches,
    current_workspace,
    current_workspace_id,
    public_endpoint,
    try_bind_workspace,
    workspace_required,
    workspace_role_label_overrides,
)


settings_bp = Blueprint("settings", __name__)

PLATFORM_NAME = "TaskGo"
BRANDING_NAME_KEY = "branding_name"
BRANDING_LOGO_KEY = "branding_logo_path"
# SVG is deliberately excluded: serving an administrator-uploaded SVG from the
# application origin can become stored XSS when the file is opened directly.
LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
LOGO_TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")
TASK_NOTE_TEMPLATES_KEY = "task_update_note_templates"
DEFAULT_TASK_NOTE_TEMPLATES = [
    "已到場，開始作業。",
    "已完成檢修。",
    "等待材料/零件中。",
    "已完成並清潔收尾。",
]


def _storage():
    storage = current_app.extensions.get("storage")
    if not storage:
        raise RuntimeError("Storage backend is not configured")
    return storage


def _logo_token(logo_path: str | None) -> str | None:
    if not logo_path:
        return None
    stem, ext = os.path.splitext(os.path.basename(logo_path))
    if ext.lower() not in LOGO_EXTENSIONS or not stem.startswith("logo-"):
        return None
    token = stem[len("logo-"):]
    return token if LOGO_TOKEN_RE.match(token) else None


def _serialize_branding(workspace=None):
    """Company branding inside a workspace; TaskGo platform branding otherwise."""
    if workspace is None:
        return {
            "name": PLATFORM_NAME,
            "platform_name": PLATFORM_NAME,
            "workspace_id": None,
            "logo_path": None,
            "logo_url": None,
            "logo_updated_at": None,
        }

    name = WorkspaceSetting.get_value(workspace.id, BRANDING_NAME_KEY) or workspace.name
    logo_record = WorkspaceSetting.get_record(workspace.id, BRANDING_LOGO_KEY)
    logo_path = logo_record.value if logo_record else None
    logo_updated_at = (
        logo_record.updated_at.isoformat() if logo_record and logo_record.updated_at else None
    )

    logo_url = None
    token = _logo_token(logo_path)
    if token:
        try:
            storage = _storage()
        except RuntimeError:
            storage = None
        if storage:
            try:
                if getattr(storage, "use_s3", False):
                    logo_url = storage.url_for(logo_path, expires_in=3600)
                else:
                    logo_url = url_for(
                        "settings.serve_branding_logo",
                        token=token,
                        v=logo_updated_at or "0",
                        _external=False,
                    )
            except StorageError:
                logo_url = None

    return {
        "name": name,
        "platform_name": PLATFORM_NAME,
        "workspace_id": workspace.id,
        "logo_path": logo_path,
        "logo_url": logo_url,
        "logo_updated_at": logo_updated_at,
    }


def _load_task_note_templates(workspace_id: int) -> list[str]:
    raw = WorkspaceSetting.get_value(workspace_id, TASK_NOTE_TEMPLATES_KEY)
    if raw is None:
        return list(DEFAULT_TASK_NOTE_TEMPLATES)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return list(DEFAULT_TASK_NOTE_TEMPLATES)
    if not isinstance(parsed, list):
        return list(DEFAULT_TASK_NOTE_TEMPLATES)
    return [str(item).strip() for item in parsed if str(item).strip()]


@settings_bp.get("/branding")
@public_endpoint
def get_branding():
    # Public so the login screen can render TaskGo; company branding is only
    # returned after the caller proves membership with a valid token.
    from tenancy import _load_current_user

    workspace = None
    if request.headers.get("Authorization"):
        user, error = _load_current_user()
        if error is None:
            try_bind_workspace(user)
            workspace = current_workspace()
    return jsonify(_serialize_branding(workspace))


@settings_bp.get("/branding/logo/<string:token>")
@public_endpoint  # unguessable per-upload token; logos are not confidential
def serve_branding_logo(token: str):
    if not LOGO_TOKEN_RE.match(token or ""):
        return jsonify({"msg": "Logo not found"}), 404
    record = WorkspaceSetting.query.filter(
        WorkspaceSetting.key == BRANDING_LOGO_KEY,
        WorkspaceSetting.value.like(f"%logo-{token}.%"),
    ).first()
    logo_path = record.value if record else None
    if _logo_token(logo_path) != token:
        return jsonify({"msg": "Logo not found"}), 404

    try:
        storage = _storage()
    except RuntimeError:
        return jsonify({"msg": "Storage backend is not configured"}), 500

    if getattr(storage, "use_s3", False):
        try:
            url = storage.url_for(logo_path, expires_in=3600)
        except StorageError:
            return jsonify({"msg": "Unable to generate logo URL"}), 500
        return redirect(url)

    try:
        path = storage.local_path(logo_path)
    except FileNotFoundError:
        return jsonify({"msg": "Logo not found"}), 404
    except StorageError:
        return jsonify({"msg": "Unable to locate logo"}), 500

    return send_from_directory(path.parent, path.name)


@settings_bp.put("/branding/name")
@workspace_required("admin")
def update_branding_name():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    if not name:
        return jsonify({"msg": "公司顯示名稱不可為空白"}), 400
    if len(name) > 120:
        return jsonify({"msg": "公司顯示名稱過長"}), 400

    WorkspaceSetting.set_value(current_workspace_id(), BRANDING_NAME_KEY, name)
    return jsonify(_serialize_branding(current_workspace()))


@settings_bp.post("/branding/logo")
@workspace_required("admin")
def upload_branding_logo():
    if "file" not in request.files:
        return jsonify({"msg": "請選擇要上傳的圖片"}), 400

    file = request.files["file"]
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()

    if ext not in LOGO_EXTENSIONS:
        return (
            jsonify({"msg": "僅支援 PNG、JPG、JPEG、GIF 或 WEBP 檔案"}),
            400,
        )
    try:
        validate_upload_content(file, file_type="image", ext=ext)
    except ValueError as exc:
        return jsonify({"msg": str(exc)}), 400

    try:
        storage = _storage()
    except RuntimeError:
        return jsonify({"msg": "Storage backend is not configured"}), 500

    workspace_id = current_workspace_id()
    previous_path = WorkspaceSetting.get_value(workspace_id, BRANDING_LOGO_KEY)
    relative_path = f"branding/ws{workspace_id}/logo-{uuid.uuid4().hex}{ext}"

    try:
        file.stream.seek(0)
        storage.save(relative_path, file.stream)
    except Exception as exc:
        current_app.logger.error("Logo upload failed: %s", exc)
        return jsonify({"msg": "上傳公司 Logo 失敗"}), 500

    WorkspaceSetting.set_value(workspace_id, BRANDING_LOGO_KEY, relative_path)

    if previous_path:
        try:
            storage.delete(previous_path)
        except Exception as exc:  # pragma: no cover - best-effort cleanup
            current_app.logger.warning("Failed to delete previous logo %s: %s", previous_path, exc)

    return jsonify(_serialize_branding(current_workspace())), 201


@settings_bp.delete("/branding/logo")
@workspace_required("admin")
def delete_branding_logo():
    workspace_id = current_workspace_id()
    previous_path = WorkspaceSetting.get_value(workspace_id, BRANDING_LOGO_KEY)

    WorkspaceSetting.delete_value(workspace_id, BRANDING_LOGO_KEY)

    if previous_path:
        try:
            storage = _storage()
        except RuntimeError:
            storage = None
        if storage is not None:
            try:
                storage.delete(previous_path)
            except Exception as exc:  # pragma: no cover - best-effort cleanup
                current_app.logger.warning("Failed to delete logo %s: %s", previous_path, exc)

    return jsonify(_serialize_branding(current_workspace())), 200


@settings_bp.get("/task-update-templates")
@workspace_required()
def get_task_update_templates():
    return jsonify({"templates": _load_task_note_templates(current_workspace_id())})


@settings_bp.put("/task-update-templates")
@workspace_required("admin")
def update_task_update_templates():
    data = request.get_json(silent=True) or {}
    templates = data.get("templates")

    if templates is None:
        return jsonify({"msg": "templates 為必填欄位"}), 400
    if not isinstance(templates, list):
        return jsonify({"msg": "templates 必須是陣列"}), 400

    cleaned = [str(item).strip() for item in templates if str(item).strip()]
    WorkspaceSetting.set_value(
        current_workspace_id(),
        TASK_NOTE_TEMPLATES_KEY,
        json.dumps(cleaned, ensure_ascii=False),
    )
    return jsonify({"templates": cleaned})


def _role_label_payload():
    overrides = workspace_role_label_overrides(current_workspace_id())
    return {
        "labels": {**WORKSPACE_ROLE_LABEL_DEFAULTS, **overrides},
        "overrides": overrides,
        "defaults": WORKSPACE_ROLE_LABEL_DEFAULTS,
    }


def _save_role_label_overrides(overrides: dict) -> None:
    WorkspaceSetting.set_value(
        current_workspace_id(),
        ROLE_LABELS_KEY,
        json.dumps(overrides, ensure_ascii=False),
    )
    clear_request_caches()


@settings_bp.get("/roles")
@workspace_required()
def get_role_labels():
    return jsonify(_role_label_payload())


@settings_bp.put("/roles/<string:role>")
@workspace_required("admin")
def update_role_label(role: str):
    if role not in WORKSPACE_ROLE_LABEL_DEFAULTS:
        return jsonify({"msg": "Unknown role"}), 400

    data = request.get_json(silent=True) or {}
    label = (data.get("label") or "").strip()

    if not label:
        return jsonify({"msg": "顯示名稱不可為空白"}), 400
    if len(label) > 80:
        return jsonify({"msg": "顯示名稱過長"}), 400

    overrides = workspace_role_label_overrides(current_workspace_id())
    overrides[role] = label
    _save_role_label_overrides(overrides)
    return jsonify(_role_label_payload())


@settings_bp.delete("/roles/<string:role>")
@workspace_required("admin")
def reset_role_label(role: str):
    if role not in WORKSPACE_ROLE_LABEL_DEFAULTS:
        return jsonify({"msg": "Unknown role"}), 400

    overrides = workspace_role_label_overrides(current_workspace_id())
    if overrides.pop(role, None) is not None:
        _save_role_label_overrides(overrides)
    return jsonify(_role_label_payload())


# Email/LINE notification rules are still global (site_setting); until Phase 2
# makes them per workspace, only the migrated legacy workspace may edit them.


def _task_status_options() -> list[str]:
    try:
        from routes.tasks import TASK_STATUS_OPTIONS
        return list(TASK_STATUS_OPTIONS)
    except Exception:
        return ["尚未接單", "已接單", "進行中", "已完成"]


@settings_bp.get("/notifications/email")
@workspace_required("admin", legacy_only=True)
def get_email_notification_settings():
    """Admin: read email-notification rules (LINE notifications are unaffected)."""
    from services.notifications import get_email_notification_settings as _get
    return jsonify(
        {
            "settings": _get(),
            "status_options": _task_status_options(),
        }
    )


@settings_bp.put("/notifications/email")
@workspace_required("admin", legacy_only=True)
def update_email_notification_settings():
    """Admin: update email-notification rules."""
    from services.notifications import save_email_notification_settings as _save
    data = request.get_json(silent=True) or {}
    # Let the service normalize/merge, but validate input here for better UX.
    status_options = _task_status_options()

    status_targets = data.get("status_targets")
    if status_targets is not None:
        if not isinstance(status_targets, list):
            return jsonify({"msg": "status_targets 必須是陣列"}), 400
        cleaned = [str(item).strip() for item in status_targets if str(item).strip()]
        invalid = [s for s in cleaned if s not in status_options]
        if invalid:
            return jsonify({"msg": f"未知的狀態：{', '.join(invalid)}"}), 400
        data["status_targets"] = cleaned

    # Very light validation for URLs (optional field)
    if "task_link_base_url" in data and data["task_link_base_url"] is not None:
        data["task_link_base_url"] = str(data["task_link_base_url"]).strip()

    if "subject_prefix" in data and data["subject_prefix"] is not None:
        data["subject_prefix"] = str(data["subject_prefix"])

    updated = _save(data)
    return jsonify({"settings": updated, "status_options": status_options})


@settings_bp.get("/notifications/line")
@workspace_required("admin", legacy_only=True)
def get_line_notification_settings():
    """Admin: read LINE (Bot) notification rules."""
    from services.notifications import get_line_notification_settings as _get
    from services.line_messaging import has_line_bot_config as _has_line_bot
    return jsonify(
        {
            "settings": _get(),
            "status_options": _task_status_options(),
            "has_line_bot": _has_line_bot(),
            "has_public_line_bot": _has_line_bot(channel="public"),
        }
    )


@settings_bp.put("/notifications/line")
@workspace_required("admin", legacy_only=True)
def update_line_notification_settings():
    """Admin: update LINE (Bot) notification rules."""
    from services.notifications import save_line_notification_settings as _save
    data = request.get_json(silent=True) or {}
    status_options = _task_status_options()

    status_targets = data.get("status_targets")
    if status_targets is not None:
        if not isinstance(status_targets, list):
            return jsonify({"msg": "status_targets 必須是陣列"}), 400
        cleaned = [str(item).strip() for item in status_targets if str(item).strip()]
        invalid = [s for s in cleaned if s not in status_options]
        if invalid:
            return jsonify({"msg": f"未知的狀態：{', '.join(invalid)}"}), 400
        data["status_targets"] = cleaned

    if "task_link_base_url" in data and data["task_link_base_url"] is not None:
        data["task_link_base_url"] = str(data["task_link_base_url"]).strip()

    updated = _save(data)
    return jsonify({"settings": updated, "status_options": status_options})
