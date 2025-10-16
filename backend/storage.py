"""Storage backends for TaskGo uploads."""

from __future__ import annotations

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


@dataclass
class LocalStorage:
    """Store files on the local filesystem."""

    base_dir: Path

    def __post_init__(self) -> None:
        self.base_dir = Path(self.base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save(self, relative_path: str, data: bytes | BinaryIO) -> str:
        target = self.base_dir / Path(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = _read_bytes(data)
        with open(target, "wb") as handle:
            handle.write(payload)
        return relative_path.replace("\\", "/")

    def delete(self, relative_path: str) -> None:
        try:
            (self.base_dir / Path(relative_path)).unlink(missing_ok=True)
        except AttributeError:
            # Python <3.8 compatibility: best-effort removal
            full_path = self.base_dir / Path(relative_path)
            if full_path.exists():
                try:
                    full_path.unlink()
                except OSError:
                    pass

    def local_path(self, relative_path: str) -> Path:
        path = self.base_dir / Path(relative_path)
        if not path.exists():
            raise FileNotFoundError(relative_path)
        return path

    def url_for(self, relative_path: str) -> str:
        return f"/api/upload/files/{relative_path.replace('\\', '/')}"


class S3Storage:
    """Store files on AWS S3."""

    def __init__(
        self,
        *,
        bucket: str,
        base_path: str = "",
        region_name: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        default_expiry: int = 3600,
    ) -> None:
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise StorageError("boto3 is required for S3 storage") from exc

        self._client = boto3.client(
            "s3", region_name=region_name, endpoint_url=endpoint_url
        )
        self._bucket = bucket
        self._base_path = base_path.strip("/")
        self._expiry = default_expiry

    def _key(self, relative_path: str) -> str:
        key = relative_path.replace("\\", "/").lstrip("/")
        if self._base_path:
            return f"{self._base_path}/{key}"
        return key

    def save(self, relative_path: str, data: bytes | BinaryIO) -> str:
        payload = _read_bytes(data)
        key = self._key(relative_path)
        self._client.put_object(Bucket=self._bucket, Key=key, Body=payload)
        return relative_path.replace("\\", "/")

    def delete(self, relative_path: str) -> None:
        key = self._key(relative_path)
        self._client.delete_object(Bucket=self._bucket, Key=key)

    def local_path(self, relative_path: str) -> Path:
        raise StorageError("S3 storage does not provide local file paths")

    def url_for(self, relative_path: str, *, expires_in: Optional[int] = None) -> str:
        key = self._key(relative_path)
        expiry = expires_in or self._expiry
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expiry,
        )


def create_storage(config: dict) -> LocalStorage | S3Storage:
    mode = (config.get("STORAGE_MODE") or "local").lower()

    if mode == "s3":
        bucket = config.get("S3_BUCKET")
        if not bucket:
            raise StorageError("S3_BUCKET must be configured when STORAGE_MODE=s3")
        return S3Storage(
            bucket=bucket,
            base_path=config.get("S3_BASE_PATH", ""),
            region_name=config.get("S3_REGION_NAME"),
            endpoint_url=config.get("S3_ENDPOINT_URL"),
            default_expiry=config.get("S3_URL_EXPIRY", 3600),
        )

    uploads_dir = config.get("UPLOAD_FOLDER")
    if not uploads_dir:
        raise StorageError("UPLOAD_FOLDER must be configured for local storage")
    return LocalStorage(Path(uploads_dir))

