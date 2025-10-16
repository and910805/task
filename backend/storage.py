"""Storage backends for TaskGo uploads with local/S3 support."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import BinaryIO, Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError


USE_S3 = True
S3_BUCKET = "taskgo-uploads"
S3_REGION = "ap-northeast-1"


class StorageError(RuntimeError):
    """Raised when a storage backend cannot fulfill a request."""


def _read_bytes(source: bytes | BinaryIO) -> bytes:
    if isinstance(source, bytes):
        return source

    source.seek(0)
    return source.read()


def _normalise_relative_path(relative_path: str) -> str:
    return relative_path.replace("\\", "/").lstrip("/")


@dataclass
class LocalStorage:
    """Store files on the local filesystem."""

    base_dir: Path
    use_s3: bool = False

    def __post_init__(self) -> None:
        self.base_dir = Path(self.base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save(self, relative_path: str, data: bytes | BinaryIO) -> str:
        target = self.base_dir / Path(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = _read_bytes(data)
        with open(target, "wb") as handle:
            handle.write(payload)
        relative_path = _normalise_relative_path(relative_path)
        return relative_path

    def delete(self, relative_path: str) -> None:
        target = self.base_dir / Path(relative_path)
        try:
            target.unlink(missing_ok=True)
        except TypeError:
            if target.exists():
                try:
                    target.unlink()
                except OSError:
                    pass

    def local_path(self, relative_path: str) -> Path:
        path = self.base_dir / Path(relative_path)
        if not path.exists():
            raise FileNotFoundError(relative_path)
        return path

    def url_for(self, relative_path: str) -> str:
        relative_path = _normalise_relative_path(relative_path)
        return f"/api/upload/files/{relative_path}"


class S3Storage:
    """Store files on AWS S3."""

    use_s3: bool = True

    def __init__(
        self,
        *,
        bucket: str,
        region_name: Optional[str] = None,
        default_expiry: int = 3600,
        base_prefix: str = "uploads",
        endpoint_url: Optional[str] = None,
    ) -> None:
        client_kwargs = {"region_name": region_name}
        if endpoint_url:
            client_kwargs["endpoint_url"] = endpoint_url
        self._client = boto3.client("s3", **client_kwargs)
        self._bucket = bucket
        self._expiry = default_expiry
        self._base_prefix = base_prefix.strip("/")

        try:
            self._client.head_bucket(Bucket=bucket)
        except ClientError as exc:
            raise StorageError("S3 bucket not found") from exc

    def _split_relative(self, relative_path: str) -> tuple[str, str]:
        normalized = _normalise_relative_path(relative_path)
        parts = normalized.split("/", 1)
        if len(parts) == 2:
            return parts[0], parts[1]
        return "other", parts[0]

    def _key(self, relative_path: str) -> str:
        category, filename = self._split_relative(relative_path)
        key = f"{self._base_prefix}/{category}/{filename}" if self._base_prefix else f"{category}/{filename}"
        return key

    def save(self, relative_path: str, data: bytes | BinaryIO) -> str:
        payload = _read_bytes(data)
        key = self._key(relative_path)
        with NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(payload)
            temp_path = temp_file.name
        try:
            self._client.upload_file(temp_path, self._bucket, key)
        except (BotoCoreError, ClientError) as exc:
            raise StorageError("Failed to upload file to S3") from exc
        finally:
            try:
                os.remove(temp_path)
            except OSError:
                pass

        return _normalise_relative_path(relative_path)

    def delete(self, relative_path: str) -> None:
        key = self._key(relative_path)
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except (BotoCoreError, ClientError) as exc:
            raise StorageError("Failed to delete S3 object") from exc

    def local_path(self, relative_path: str) -> Path:
        raise StorageError("S3 storage does not provide local file paths")

    def url_for(self, relative_path: str, expires_in: Optional[int] = None) -> str:
        key = self._key(relative_path)
        try:
            return self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=expires_in or self._expiry,
            )
        except (BotoCoreError, ClientError) as exc:
            raise StorageError("Failed to generate S3 download URL") from exc


def _coerce_bool(value: Optional[str]) -> Optional[bool]:
    if value is None:
        return None
    value = value.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return None


def _should_use_s3(config: dict) -> bool:
    flag = _coerce_bool(os.getenv("TASKGO_USE_S3"))
    if flag is None:
        flag = _coerce_bool(os.getenv("USE_S3"))
    if flag is None:
        config_flag = config.get("USE_S3")
        if isinstance(config_flag, str):
            flag = _coerce_bool(config_flag)
        elif isinstance(config_flag, bool):
            flag = config_flag
    if flag is not None:
        return bool(flag)

    mode = (config.get("STORAGE_MODE") or "").lower()
    if mode == "s3":
        return True
    if mode == "local":
        return False

    return USE_S3


def create_storage(config: dict) -> LocalStorage | S3Storage:
    if _should_use_s3(config):
        bucket = config.get("S3_BUCKET") or S3_BUCKET
        region = config.get("S3_REGION_NAME") or S3_REGION
        base_prefix = config.get("S3_BASE_PATH") or "uploads"
        endpoint_url = config.get("S3_ENDPOINT_URL")
        if not bucket:
            raise StorageError("S3 bucket not found")
        return S3Storage(
            bucket=bucket,
            region_name=region,
            default_expiry=config.get("S3_URL_EXPIRY", 3600),
            base_prefix=base_prefix,
            endpoint_url=endpoint_url,
        )

    uploads_dir = config.get("UPLOAD_FOLDER")
    if not uploads_dir:
        raise StorageError("UPLOAD_FOLDER must be configured for local storage")
    return LocalStorage(Path(uploads_dir))

