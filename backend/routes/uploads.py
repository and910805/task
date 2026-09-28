"""Blueprint dedicated to rich media uploads for TaskGo tasks."""

from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, redirect, request, send_from_directory
from flask_jwt_extended import (
    decode_token,
    get_jwt_identity,
    verify_jwt_in_request,
)
from flask_jwt_extended.exceptions import NoAuthorizationError

from extensions import db
from models import Attachment, Invoice, Task, User, Workspace, WorkspaceMember
from services.attachments import create_file_attachment, create_signature_attachment
from tenancy import current_role, current_workspace_id, public_endpoint, workspace_required
from utils import get_current_user_id, task_is_accessible
from storage import StorageError


upload_bp = Blueprint("upload", __name__)


def _check_task_permission(task: Task, *, message: str):
    role = current_role()
    user_id = get_current_user_id()
    if user_id is None:
        return None, jsonify({"msg": "Invalid authentication token"}), 401

    if not task_is_accessible(task, role, user_id):
        return None, jsonify({"msg": message}), 403

    return user_id, None, None


def _serve_file(filename: str, *, as_attachment: bool = False):
    storage = current_app.extensions.get("storage")
    if storage is None:
        return jsonify({"msg": "Storage backend is not configured"}), 500

    if getattr(storage, "use_s3", False):
        try:
            url = storage.url_for(filename, expires_in=3600)
        except StorageError:
            return jsonify({"msg": "Unable to generate download link"}), 500
        return redirect(url)

    try:
        path = storage.local_path(filename)
    except FileNotFoundError:
        return jsonify({"msg": "File not found"}), 404
    except StorageError:
        return jsonify({"msg": "File not found"}), 404
    except AttributeError:
        try:
            if getattr(storage, "use_s3", False):
                url = storage.url_for(filename, expires_in=3600)
            else:
                url = storage.url_for(filename)
        except StorageError:
            return jsonify({"msg": "Unable to generate download link"}), 500
        return redirect(url)

    return send_from_directory(path.parent, path.name, as_attachment=as_attachment)


def _authenticated_download_user(filename: str) -> User | None:
    identity = None
    try:
        verify_jwt_in_request()
        identity = get_jwt_identity()
    except NoAuthorizationError:
        token_value = request.args.get("token", type=str)
        if not token_value:
            return None
        try:
            decoded = decode_token(token_value)
        except Exception:
            return None

        expiry = decoded.get("exp")
        if expiry is not None:
            expires_at = datetime.fromtimestamp(expiry, tz=timezone.utc)
            if expires_at <= datetime.now(timezone.utc):
                return None

        normalized_filename = filename.replace("\\", "/").lstrip("/")
        if decoded.get("download_path") != normalized_filename:
            return None
        identity = decoded.get("sub")

    try:
        user_id = int(identity)
    except (TypeError, ValueError):
        return None
    return db.session.get(User, user_id)


def _member_role(user: User, workspace_id: int | None) -> str | None:
    if workspace_id is None:
        return None
    membership = (
        WorkspaceMember.query.join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .filter(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == "active",
            Workspace.status == "active",
        )
        .first()
    )
    return membership.role if membership else None


def _report_workspace_id(normalized: str) -> int | None:
    # reports/ws<id>/<file>.xlsx; older unscoped reports belong to the legacy workspace.
    parts = normalized.split("/")
    if len(parts) == 3 and parts[1].startswith("ws") and parts[1][2:].isdigit():
        return int(parts[1][2:])
    if len(parts) == 2:
        legacy = Workspace.query.filter_by(is_legacy=True).order_by(Workspace.id.asc()).first()
        return legacy.id if legacy else None
    return None


def _can_download_file(user: User, filename: str) -> bool:
    """Files are downloadable only by members of the owning workspace."""
    normalized = filename.replace("\\", "/").lstrip("/")
    manager_roles = {"admin", "site_supervisor", "hq_staff"}

    attachment = Attachment.query.filter_by(file_path=normalized).first()
    if attachment is not None and attachment.task is not None:
        role = _member_role(user, attachment.task.workspace_id)
        return role is not None and task_is_accessible(attachment.task, role, user.id)

    invoice = Invoice.query.filter_by(customer_signature_path=normalized).first()
    if invoice is not None:
        return _member_role(user, invoice.workspace_id) in manager_roles

    if normalized.startswith("reports/"):
        return _member_role(user, _report_workspace_id(normalized)) in manager_roles

    return False


@upload_bp.post("/tasks/<int:task_id>/images")
@workspace_required()
def upload_image(task_id: int):
    task = Task.query.filter(Task.id == task_id, Task.workspace_id == current_workspace_id()).first_or_404()
    user_id, error_response, status = _check_task_permission(
        task, message="You cannot upload photos for this task"
    )
    if error_response:
        return error_response, status

    if "file" not in request.files:
        return jsonify({"msg": "請選擇要上傳的圖片"}), 400

    file = request.files["file"]
    note = request.form.get("note")

    try:
        attachment = create_file_attachment(
            task,
            user_id=user_id,
            uploaded_file=file,
            file_type="image",
            note=note,
        )
    except ValueError as exc:
        return jsonify({"msg": str(exc)}), 400
    except RuntimeError as exc:
        current_app.logger.error("Image upload failed: %s", exc)
        return jsonify({"msg": "圖片上傳失敗"}), 500

    return jsonify(attachment.to_dict()), 201


@upload_bp.post("/tasks/<int:task_id>/audio")
@workspace_required()
def upload_audio(task_id: int):
    task = Task.query.filter(Task.id == task_id, Task.workspace_id == current_workspace_id()).first_or_404()
    user_id, error_response, status = _check_task_permission(
        task, message="You cannot upload audio for this task"
    )
    if error_response:
        return error_response, status

    if "file" not in request.files:
        return jsonify({"msg": "請選擇要上傳的語音檔"}), 400

    file = request.files["file"]
    note = request.form.get("note")
    transcript = request.form.get("transcript")

    try:
        attachment = create_file_attachment(
            task,
            user_id=user_id,
            uploaded_file=file,
            file_type="audio",
            note=note,
            transcript=transcript,
        )
    except ValueError as exc:
        return jsonify({"msg": str(exc)}), 400
    except RuntimeError as exc:
        current_app.logger.error("Audio upload failed: %s", exc)
        return jsonify({"msg": "語音上傳失敗"}), 500

    return jsonify(attachment.to_dict()), 201


@upload_bp.post("/tasks/<int:task_id>/signature")
@workspace_required()
def upload_signature(task_id: int):
    task = Task.query.filter(Task.id == task_id, Task.workspace_id == current_workspace_id()).first_or_404()
    user_id, error_response, status = _check_task_permission(
        task, message="You cannot upload signatures for this task"
    )
    if error_response:
        return error_response, status

    data = request.get_json(silent=True) or {}
    data_url = data.get("data_url")
    if not data_url:
        return jsonify({"msg": "缺少簽名資料"}), 400
    note = data.get("note")

    try:
        attachment = create_signature_attachment(
            task, user_id=user_id, data_url=data_url, note=note
        )
    except ValueError as exc:
        return jsonify({"msg": str(exc)}), 400
    except RuntimeError as exc:
        current_app.logger.error("Signature upload failed: %s", exc)
        return jsonify({"msg": "簽名上傳失敗"}), 500

    return jsonify(attachment.to_dict()), 201


@upload_bp.get("/files/<path:filename>")
@public_endpoint  # authenticates itself: header JWT or a short-lived per-file token
def download_file(filename: str):
    user = _authenticated_download_user(filename)
    if user is None:
        return jsonify({"msg": "Missing or invalid authentication token"}), 401
    if not _can_download_file(user, filename):
        return jsonify({"msg": "File not found"}), 404
    normalized = filename.replace("\\", "/").lstrip("/")
    attachment = Attachment.query.filter_by(file_path=normalized).first()
    return _serve_file(filename, as_attachment=bool(attachment and attachment.file_type == "other"))
