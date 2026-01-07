import os
import uuid
import json

from flask import Blueprint, current_app, jsonify, redirect, request, send_from_directory, url_for
from flask_jwt_extended import jwt_required

from decorators import role_required
from extensions import db
from models import ROLE_LABEL_DEFAULTS, RoleLabel, SiteSetting
from storage import StorageError


settings_bp = Blueprint("settings", __name__)


def _serialize_role_labels():
    overrides = RoleLabel.get_overrides()
    labels = {**ROLE_LABEL_DEFAULTS, **overrides}
    return overrides, labels


DEFAULT_BRANDING_NAME = "立翔水電行"
BRANDING_NAME_KEY = "branding_name"
BRANDING_LOGO_KEY = "branding_logo_path"
LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
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


def _serialize_branding():
    name = SiteSetting.get_value(BRANDING_NAME_KEY, DEFAULT_BRANDING_NAME) or DEFAULT_BRANDING_NAME
    logo_record = SiteSetting.get_record(BRANDING_LOGO_KEY)
    logo_path = logo_record.value if logo_record else None
    logo_updated_at = (
        logo_record.updated_at.isoformat() if logo_record and logo_record.updated_at else None
    )

    logo_url = None
    if logo_path:
        try:
            storage = _storage()
        except RuntimeError:
            storage = None
        if storage:
            try:
                if getattr(storage, "use_s3", False):
                    logo_url = storage.url_for(logo_path, expires_in=3600)
                else:
                    version = logo_updated_at or "0"
                    logo_url = url_for(
                        "settings.serve_branding_logo",
                        v=version,
                        _external=False,
                    )
            except StorageError:
                logo_url = None

    return {
        "name": name,
        "logo_path": logo_path,
        "logo_url": logo_url,
        "logo_updated_at": logo_updated_at,
    }


def _load_task_note_templates() -> list[str]:
    raw = SiteSetting.get_value(TASK_NOTE_TEMPLATES_KEY)
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
@jwt_required(optional=True)
def get_branding():
    return jsonify(_serialize_branding())


@settings_bp.get("/branding/logo")
def serve_branding_logo():
    """Expose the configured branding logo without requiring authentication."""

    logo_record = SiteSetting.get_record(BRANDING_LOGO_KEY)
    logo_path = logo_record.value if logo_record else None

    if not logo_path:
        return jsonify({"msg": "Logo not configured"}), 404

    try:
        storage = _storage()
    except RuntimeError:
        storage = None

    if storage is None:
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
@role_required("admin")
def update_branding_name():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    if not name:
        return jsonify({"msg": "登入畫面名稱不可為空白"}), 400

    record = SiteSetting.set_value(BRANDING_NAME_KEY, name)
    db.session.refresh(record)
    return jsonify(_serialize_branding())


@settings_bp.post("/branding/logo")
@role_required("admin")
def upload_branding_logo():
    if "file" not in request.files:
        return jsonify({"msg": "請選擇要上傳的圖片"}), 400

    file = request.files["file"]
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()

    if ext not in LOGO_EXTENSIONS:
        return (
            jsonify({"msg": "僅支援 PNG、JPG、JPEG、GIF、WEBP 或 SVG 檔案"}),
            400,
        )

    try:
        storage = _storage()
    except RuntimeError:
        storage = None

    if storage is None:
        return jsonify({"msg": "Storage backend is not configured"}), 500

    previous_path = SiteSetting.get_value(BRANDING_LOGO_KEY)
    relative_path = f"branding/logo-{uuid.uuid4().hex}{ext}"

    try:
        file.stream.seek(0)
        storage.save(relative_path, file.stream)
    except Exception as exc:
        current_app.logger.error("Logo upload failed: %s", exc)
        return jsonify({"msg": "上傳網站 Logo 失敗"}), 500

    SiteSetting.set_value(BRANDING_LOGO_KEY, relative_path)

    if previous_path:
        try:
            storage.delete(previous_path)
        except Exception as exc:  # pragma: no cover - best-effort cleanup
            current_app.logger.warning("Failed to delete previous logo %s: %s", previous_path, exc)

    response = _serialize_branding()
    return jsonify(response), 201


@settings_bp.delete("/branding/logo")
@role_required("admin")
def delete_branding_logo():
    previous_path = SiteSetting.get_value(BRANDING_LOGO_KEY)

    SiteSetting.delete_value(BRANDING_LOGO_KEY)

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

    return jsonify(_serialize_branding()), 200


@settings_bp.get("/task-update-templates")
@jwt_required()
def get_task_update_templates():
    return jsonify({"templates": _load_task_note_templates()})


@settings_bp.put("/task-update-templates")
@role_required("admin")
def update_task_update_templates():
    data = request.get_json(silent=True) or {}
    templates = data.get("templates")

    if templates is None:
        return jsonify({"msg": "templates 為必填欄位"}), 400
    if not isinstance(templates, list):
        return jsonify({"msg": "templates 必須是陣列"}), 400

    cleaned = [str(item).strip() for item in templates if str(item).strip()]
    SiteSetting.set_value(
        TASK_NOTE_TEMPLATES_KEY,
        json.dumps(cleaned, ensure_ascii=False),
    )
    return jsonify({"templates": cleaned})


@settings_bp.get("/roles")
@jwt_required(optional=True)
def get_role_labels():
    overrides, labels = _serialize_role_labels()
    return jsonify(
        {
            "labels": labels,
            "overrides": overrides,
            "defaults": ROLE_LABEL_DEFAULTS,
        }
    )


@settings_bp.put("/roles/<string:role>")
@role_required("admin")
def update_role_label(role: str):
    if role not in ROLE_LABEL_DEFAULTS:
        return jsonify({"msg": "Unknown role"}), 400

    data = request.get_json(silent=True) or {}
    label = (data.get("label") or "").strip()

    if not label:
        return jsonify({"msg": "顯示名稱不可為空白"}), 400

    record = RoleLabel.query.filter_by(role=role).first()
    if record:
        record.label = label
    else:
        record = RoleLabel(role=role, label=label)
        db.session.add(record)

    db.session.commit()
    RoleLabel.clear_cache()

    overrides, labels = _serialize_role_labels()
    return jsonify({"labels": labels, "overrides": overrides})


@settings_bp.delete("/roles/<string:role>")
@role_required("admin")
def reset_role_label(role: str):
    if role not in ROLE_LABEL_DEFAULTS:
        return jsonify({"msg": "Unknown role"}), 400

    record = RoleLabel.query.filter_by(role=role).first()
    if record:
        db.session.delete(record)
        db.session.commit()
        RoleLabel.clear_cache()

    overrides, labels = _serialize_role_labels()
    return jsonify({"labels": labels, "overrides": overrides})



def _task_status_options() -> list[str]:
    try:
        from routes.tasks import TASK_STATUS_OPTIONS
        return list(TASK_STATUS_OPTIONS)
    except Exception:
        return ["尚未接單", "已接單", "進行中", "已完成"]


@settings_bp.get("/notifications/email")
@role_required("admin")
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
@role_required("admin")
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
@role_required("admin")
def get_line_notification_settings():
    """Admin: read LINE (Bot) notification rules."""
    from services.notifications import get_line_notification_settings as _get
    return jsonify(
        {
            "settings": _get(),
            "status_options": _task_status_options(),
            "has_line_bot": bool((os.getenv("LINE_CHANNEL_ACCESS_TOKEN") or "").strip()),
        }
    )


@settings_bp.put("/notifications/line")
@role_required("admin")
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
