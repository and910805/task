"""Blueprint dedicated to rich media uploads for TaskGo tasks."""

from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, redirect, request, send_from_directory
from flask_jwt_extended import (
    decode_token,
    get_jwt,
    jwt_required,
    verify_jwt_in_request,
)
from flask_jwt_extended.exceptions import NoAuthorizationError

from models import Task
from services.attachments import create_file_attachment, create_signature_attachment
from utils import get_current_user_id
from storage import StorageError


upload_bp = Blueprint("upload", __name__)


def _check_task_permission(task: Task, *, message: str):
    role = (get_jwt() or {}).get("role")
    user_id = get_current_user_id()
    if user_id is None:
        return None, jsonify({"msg": "Invalid authentication token"}), 401
    if role == "worker" and task.assigned_to_id != user_id:
        return None, jsonify({"msg": message}), 403
    return user_id, None, None


def _serve_file(filename: str):
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
    except (AttributeError, StorageError):
        try:
            if getattr(storage, "use_s3", False):
                url = storage.url_for(filename, expires_in=3600)
            else:
                url = storage.url_for(filename)
        except StorageError:
            return jsonify({"msg": "Unable to generate download link"}), 500
        return redirect(url)

    return send_from_directory(path.parent, path.name)


def _has_valid_download_token() -> bool:
    try:
        verify_jwt_in_request()
        return True
    except NoAuthorizationError:
        token_value = request.args.get("token", type=str)
        if not token_value:
            return False
        try:
            decoded = decode_token(token_value)
        except Exception:
            return False

        expiry = decoded.get("exp")
        if expiry is not None:
            expires_at = datetime.fromtimestamp(expiry, tz=timezone.utc)
            if expires_at <= datetime.now(timezone.utc):
                return False

        return True


@upload_bp.post("/tasks/<int:task_id>/images")
@jwt_required()
def upload_image(task_id: int):
    task = Task.query.get_or_404(task_id)
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
@jwt_required()
def upload_audio(task_id: int):
    task = Task.query.get_or_404(task_id)
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
@jwt_required()
def upload_signature(task_id: int):
    task = Task.query.get_or_404(task_id)
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
    except (ValueError, RuntimeError) as exc:
        current_app.logger.error("Signature upload failed: %s", exc)
        return jsonify({"msg": "簽名上傳失敗"}), 500

    return jsonify(attachment.to_dict()), 201


@upload_bp.get("/files/<path:filename>")
def download_file(filename: str):
    if not _has_valid_download_token():
        return jsonify({"msg": "Missing or invalid authentication token"}), 401
    return _serve_file(filename)

