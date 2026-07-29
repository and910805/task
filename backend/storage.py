"""Storage backends for 立翔水電行 uploads - Local storage only."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Optional


class StorageError(RuntimeError):
    """Raised when a storage backend cannot fulfill a request."""


def _read_bytes(source: bytes | BinaryIO) -> bytes:
    if isinstance(source, bytes):
        return source

    source.seek(0)
    return source.read()


def _normalise_relative_path(relative_path: str) -> str:
    return relative_path.replace("\\", "/").lstrip("/")


def _default_upload_folder() -> Path:
    configured = (os.environ.get("UPLOAD_FOLDER") or "").strip()
    if configured:
        return Path(configured).expanduser().resolve()

    zeabur_uploads = Path("/app/backend/uploads")
    if Path("/app/backend").exists() or zeabur_uploads.exists():
        return zeabur_uploads

    return (Path.cwd() / "uploads").resolve()


@dataclass
class LocalStorage:
    """Store files on the local filesystem (Zeabur Volume)."""

    base_dir: Path
    use_s3: bool = False

    def __post_init__(self) -> None:
        self.base_dir = Path(self.base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_path(self, relative_path: str) -> Path:
        raw_path = str(relative_path or "")
        normalized = _normalise_relative_path(raw_path)
        candidate = Path(normalized)
        if (
            not normalized
            or candidate.is_absolute()
            or any(part == ".." for part in candidate.parts)
        ):
            raise StorageError("Invalid storage path")

        target = (self.base_dir / candidate).resolve()
        try:
            target.relative_to(self.base_dir)
        except ValueError as exc:
            raise StorageError("Storage path escapes the configured upload directory") from exc
        return target

    def save(self, relative_path: str, data: bytes | BinaryIO) -> str:
        target = self._resolve_path(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = _read_bytes(data)
        with open(target, "wb") as handle:
            handle.write(payload)
        relative_path = _normalise_relative_path(relative_path)
        return relative_path

    def delete(self, relative_path: str) -> None:
        target = self._resolve_path(relative_path)
        try:
            target.unlink(missing_ok=True)
        except (TypeError, OSError):
            if target.exists():
                try:
                    target.unlink()
                except OSError:
                    pass

    def local_path(self, relative_path: str) -> Path:
        path = self._resolve_path(relative_path)
        if not path.exists():
            raise FileNotFoundError(relative_path)
        return path

    def url_for(self, relative_path: str) -> str:
        relative_path = _normalise_relative_path(relative_path)
        # 對應到後端服務的靜態檔案或 upload blueprint 路徑
        return f"/api/upload/files/{relative_path}"


def create_storage(config: dict) -> LocalStorage:
    """
    建立本地儲存實例。
    在 Zeabur 上，請務必將 UPLOAD_FOLDER 設定為掛載 Volume 的路徑。
    """
    uploads_dir = config.get("UPLOAD_FOLDER")
    if not uploads_dir:
        # 如果沒設定，預設使用 app 所在的目錄下的 uploads
        uploads_dir = str(_default_upload_folder())
        
    return LocalStorage(Path(uploads_dir))
