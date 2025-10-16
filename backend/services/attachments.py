"""Helper utilities for storing task attachments."""

from __future__ import annotations

import base64
import os
import re
import uuid
from typing import Optional

from flask import current_app
from werkzeug.datastructures import FileStorage

from extensions import db
from models import Attachment, Task


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic"}
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".webm"}


def _storage():
    storage = current_app.extensions.get("storage")
    if not storage:
        raise RuntimeError("Storage backend is not configured")
    return storage


def _build_relative_path(category: str, filename: str) -> str:
    filename = filename.replace("\\", "/")
    return f"{category}/{filename}"


def _save_binary(category: str, data: bytes | FileStorage, *, original_name: str) -> str:
    ext = os.path.splitext(original_name or "")[1].lower()
    safe_name = f"{uuid.uuid4().hex}{ext or ''}"
    storage = _storage()
    if isinstance(data, FileStorage):
        stream = data.stream
    else:
        stream = data
    relative_path = _build_relative_path(category, safe_name)
    storage.save(relative_path, stream)
    return relative_path


def _clean_base64(data_url: str) -> bytes:
    match = re.match(r"data:(?:image|application)/[a-zA-Z0-9.+-]+;base64,(.*)", data_url)
    if match:
        payload = match.group(1)
    else:
        payload = data_url
    return base64.b64decode(payload)


def create_file_attachment(
    task: Task,
    *,
    user_id: Optional[int],
    uploaded_file: FileStorage,
    file_type: str,
    note: Optional[str] = None,
    transcript: Optional[str] = None,
) -> Attachment:
    original_name = uploaded_file.filename or ""
    ext = os.path.splitext(original_name)[1].lower()

    if file_type == "image" and ext not in IMAGE_EXTENSIONS:
        raise ValueError("Unsupported image format")
    if file_type == "audio" and ext not in AUDIO_EXTENSIONS:
        raise ValueError("Unsupported audio format")

    category = {
        "image": "images",
        "audio": "audio",
        "signature": "signature",
    }.get(file_type, "other")

    relative_path = _save_binary(category, uploaded_file, original_name=original_name)

    attachment = Attachment(
        task_id=task.id,
        uploaded_by_id=user_id,
        file_type=file_type,
        original_name=original_name,
        file_path=relative_path,
        note=note,
        transcript=transcript,
    )
    db.session.add(attachment)
    db.session.commit()
    return attachment


def create_signature_attachment(
    task: Task,
    *,
    user_id: Optional[int],
    data_url: str,
    note: Optional[str] = None,
) -> Attachment:
    payload = _clean_base64(data_url)
    storage = _storage()

    # Remove existing signatures
    for existing in list(task.attachments):
        if existing.file_type == "signature":
            storage.delete(existing.file_path)
            db.session.delete(existing)

    relative_path = _save_binary("signature", payload, original_name="signature.png")

    attachment = Attachment(
        task_id=task.id,
        uploaded_by_id=user_id,
        file_type="signature",
        original_name="signature.png",
        file_path=relative_path,
        note=note,
    )
    db.session.add(attachment)
    db.session.commit()
    return attachment

