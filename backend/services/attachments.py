"""Helper utilities for storing task attachments."""

from __future__ import annotations

import base64
import binascii
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
OTHER_EXTENSIONS = {
    ".7z",
    ".csv",
    ".doc",
    ".docx",
    ".pdf",
    ".rar",
    ".txt",
    ".xls",
    ".xlsx",
    ".zip",
}
MAX_SIGNATURE_BYTES = 4 * 1024 * 1024


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


def _matches_image_signature(ext: str, header: bytes) -> bool:
    checks = {
        ".jpg": lambda value: value.startswith(b"\xff\xd8\xff"),
        ".jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
        ".png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
        ".gif": lambda value: value.startswith((b"GIF87a", b"GIF89a")),
        ".bmp": lambda value: value.startswith(b"BM"),
        ".webp": lambda value: len(value) >= 12 and value[:4] == b"RIFF" and value[8:12] == b"WEBP",
        ".heic": lambda value: len(value) >= 12
        and value[4:8] == b"ftyp"
        and value[8:12] in {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"},
    }
    check = checks.get(ext)
    return bool(check and check(header))


def _matches_audio_signature(ext: str, header: bytes) -> bool:
    if ext == ".mp3":
        return header.startswith(b"ID3") or (
            len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0
        )
    if ext == ".wav":
        return len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE"
    if ext == ".ogg":
        return header.startswith(b"OggS")
    if ext == ".webm":
        return header.startswith(b"\x1a\x45\xdf\xa3")
    if ext == ".aac":
        return len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xF6) == 0xF0
    if ext == ".m4a":
        return len(header) >= 12 and header[4:8] == b"ftyp"
    return False


def validate_upload_content(uploaded_file: FileStorage, *, file_type: str, ext: str) -> None:
    header = uploaded_file.stream.read(64)
    uploaded_file.stream.seek(0)
    if not header:
        raise ValueError("Uploaded file is empty")

    if file_type == "image" and not _matches_image_signature(ext, header):
        raise ValueError("Image content does not match its file extension")
    if file_type == "audio" and not _matches_audio_signature(ext, header):
        raise ValueError("Audio content does not match its file extension")


def _clean_base64(data_url: str) -> bytes:
    if not isinstance(data_url, str):
        raise ValueError("Signature data must be a PNG data URL")
    match = re.fullmatch(r"data:image/png;base64,([A-Za-z0-9+/=\r\n]+)", data_url.strip())
    if not match:
        raise ValueError("Signature data must be a PNG data URL")
    try:
        payload = base64.b64decode(match.group(1), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Signature data is not valid base64") from exc
    if not payload or len(payload) > MAX_SIGNATURE_BYTES:
        raise ValueError("Signature image is empty or too large")
    if not _matches_image_signature(".png", payload[:64]):
        raise ValueError("Signature data is not a valid PNG image")
    return payload


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
    if file_type == "other" and ext not in OTHER_EXTENSIONS:
        raise ValueError("Unsupported attachment format")
    if file_type in {"image", "audio"}:
        validate_upload_content(uploaded_file, file_type=file_type, ext=ext)

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


def replace_signature_file(*, existing_path: Optional[str], data_url: str) -> str:
    payload = _clean_base64(data_url)
    storage = _storage()
    if existing_path:
        storage.delete(existing_path)
    return _save_binary("signature", payload, original_name="signature.png")

