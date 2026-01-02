"""Utility helpers for delivering task notifications."""

from __future__ import annotations

import json

import os
import smtplib
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage
from typing import Iterable, Sequence

import requests
from flask import current_app

LINE_NOTIFY_ENDPOINT = "https://notify-api.line.me/api/notify"

# A small shared pool for async email sending. This keeps API requests snappy.
_EMAIL_POOL: ThreadPoolExecutor | None = None

# ---- Email notification rules (admin configurable) ----
# Stored in SiteSetting as JSON under this key.
EMAIL_NOTIFICATION_SETTINGS_KEY = "email_notification_settings"

DEFAULT_EMAIL_NOTIFICATION_SETTINGS = {
    # Global switch for email notifications (LINE notifications are unaffected).
    "enabled": True,
    # Send email when a user is newly assigned to a task.
    "send_on_assignment": True,
    # Send email when task status changes.
    "send_on_status_change": True,
    # If non-empty, only send status-change emails when the new status is in this list.
    # Empty list means "all statuses".
    "status_targets": ["尚未接單", "進行中", "已完成"],
    # Optional subject prefix, e.g. "[TaskGo] "
    "subject_prefix": "",
    # Optionally append a task link at the bottom of emails.
    "include_task_link": False,
    # If empty, will fallback to APP_BASE_URL env var. Example: "https://task.kuanlin.pro"
    "task_link_base_url": "",
}


def _load_email_settings() -> dict:
    """Load and normalize email notification settings from SiteSetting."""
    try:
        from models import SiteSetting  # local import to avoid import cycles
    except Exception:
        return dict(DEFAULT_EMAIL_NOTIFICATION_SETTINGS)

    raw = SiteSetting.get_value(EMAIL_NOTIFICATION_SETTINGS_KEY)
    data = {}
    if raw:
        try:
            data = json.loads(raw)
        except Exception:
            data = {}

    if not isinstance(data, dict):
        data = {}

    merged = {**DEFAULT_EMAIL_NOTIFICATION_SETTINGS, **data}

    merged["enabled"] = _bool(merged.get("enabled"), True)
    merged["send_on_assignment"] = _bool(merged.get("send_on_assignment"), True)
    merged["send_on_status_change"] = _bool(merged.get("send_on_status_change"), True)
    merged["include_task_link"] = _bool(merged.get("include_task_link"), False)

    targets = merged.get("status_targets")
    if targets is None:
        targets = []
    if not isinstance(targets, list):
        targets = []
    merged["status_targets"] = [str(item).strip() for item in targets if str(item).strip()]

    merged["subject_prefix"] = str(merged.get("subject_prefix") or "")
    merged["task_link_base_url"] = str(merged.get("task_link_base_url") or "")
    return merged


def get_email_notification_settings() -> dict:
    """Public helper for routes to read current settings."""
    return _load_email_settings()


def save_email_notification_settings(settings: dict) -> dict:
    """Persist email notification settings to SiteSetting (returns normalized settings)."""
    try:
        from models import SiteSetting  # local import to avoid import cycles
    except Exception:
        return _load_email_settings()

    normalized = {**_load_email_settings(), **(settings or {})}
    SiteSetting.set_value(
        EMAIL_NOTIFICATION_SETTINGS_KEY,
        json.dumps(normalized, ensure_ascii=False),
    )
    return _load_email_settings()


def _email_subject(base_subject: str) -> str:
    settings = _load_email_settings()
    prefix = (settings.get("subject_prefix") or "").strip()
    return f"{prefix}{base_subject}" if prefix else base_subject


def _append_task_link(message: str, task: "Task") -> str:
    settings = _load_email_settings()
    if not settings.get("include_task_link"):
        return message

    base = (settings.get("task_link_base_url") or "").strip().rstrip("/")
    if not base:
        base = (os.getenv("APP_BASE_URL") or "").strip().rstrip("/")
    if not base:
        return message

    try:
        url = f"{base}/tasks/{task.id}"
    except Exception:
        return message
    return f"{message}\n\n任務連結：{url}"


def _should_send_email(kind: str | None, *, status: str | None = None) -> bool:
    """Check email rules. kind: 'assignment' | 'status_change' | None."""
    if kind is None:
        return True
    settings = _load_email_settings()
    if not settings.get("enabled"):
        return False
    if not has_email_config():
        return False

    if kind == "assignment":
        return bool(settings.get("send_on_assignment"))

    if kind == "status_change":
        if not settings.get("send_on_status_change"):
            return False
        targets: list[str] = settings.get("status_targets") or []
        if targets and status:
            return status in targets
        if targets and not status:
            return False
        return True

    return True

def _send_line_notify(token: str, message: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    data = {"message": message}
    try:
        response = requests.post(
            LINE_NOTIFY_ENDPOINT, headers=headers, data=data, timeout=10
        )
        if response.status_code >= 400:
            current_app.logger.warning(
                "LINE Notify request failed: status=%s body=%s",
                response.status_code,
                response.text,
            )
    except Exception as exc:  # pragma: no cover - defensive
        current_app.logger.warning("Unable to send LINE notification: %s", exc)


def _get_email_config() -> dict[str, str | int | None]:
    """Read SMTP settings from environment first, then Flask config.

    Required:
      - EMAIL_SMTP_HOST
      - EMAIL_SENDER
    Optional:
      - EMAIL_SMTP_PORT (default 587)
      - EMAIL_SMTP_USERNAME / EMAIL_SMTP_PASSWORD
      - EMAIL_SMTP_USE_TLS (STARTTLS, default true)
      - EMAIL_SMTP_USE_SSL (SMTPS, default false; port 465)
      - EMAIL_SMTP_TIMEOUT (default 10)
      - EMAIL_SMTP_RETRIES (default 2)
      - EMAIL_REPLY_TO (optional)
      - EMAIL_ASYNC (default true)
      - EMAIL_WORKERS (default 2)
    """

    cfg_get = current_app.config.get
    env = os.getenv

    return {
        "host": env("EMAIL_SMTP_HOST") or cfg_get("EMAIL_SMTP_HOST"),
        "port": env("EMAIL_SMTP_PORT") or cfg_get("EMAIL_SMTP_PORT"),
        "username": env("EMAIL_SMTP_USERNAME") or cfg_get("EMAIL_SMTP_USERNAME"),
        "password": env("EMAIL_SMTP_PASSWORD") or cfg_get("EMAIL_SMTP_PASSWORD"),
        "sender": env("EMAIL_SENDER") or cfg_get("EMAIL_SENDER"),
        "reply_to": env("EMAIL_REPLY_TO") or cfg_get("EMAIL_REPLY_TO"),
        "use_tls": env("EMAIL_SMTP_USE_TLS") or cfg_get("EMAIL_SMTP_USE_TLS", "true"),
        "use_ssl": env("EMAIL_SMTP_USE_SSL") or cfg_get("EMAIL_SMTP_USE_SSL", "false"),
        "timeout": env("EMAIL_SMTP_TIMEOUT") or cfg_get("EMAIL_SMTP_TIMEOUT", "10"),
        "retries": env("EMAIL_SMTP_RETRIES") or cfg_get("EMAIL_SMTP_RETRIES", "2"),
        "async": env("EMAIL_ASYNC") or cfg_get("EMAIL_ASYNC", "true"),
        "workers": env("EMAIL_WORKERS") or cfg_get("EMAIL_WORKERS", "2"),
    }


def has_email_config() -> bool:
    cfg = _get_email_config()
    return bool(cfg.get("host") and cfg.get("sender"))


def _bool(v: object, default: bool = False) -> bool:
    if v is None:
        return default
    return str(v).strip().lower() not in {"0", "false", "no", "off", ""}


def _int(v: object, default: int) -> int:
    try:
        return int(v)  # type: ignore[arg-type]
    except Exception:
        return default


def _get_email_pool() -> ThreadPoolExecutor:
    global _EMAIL_POOL
    if _EMAIL_POOL is None:
        cfg = _get_email_config()
        workers = _int(cfg.get("workers"), 2)
        _EMAIL_POOL = ThreadPoolExecutor(max_workers=max(1, workers))
    return _EMAIL_POOL


def send_email(
    recipient: str,
    subject: str,
    message: str,
    *,
    html: str | None = None,
) -> None:
    """Send an email (synchronous)."""
    cfg = _get_email_config()
    host = cfg.get("host")
    sender = cfg.get("sender")
    if not host or not sender:
        current_app.logger.info(
            "Email notification skipped because SMTP settings are incomplete"
        )
        return

    port = _int(cfg.get("port"), 587)
    username = cfg.get("username")
    password = cfg.get("password")
    timeout = _int(cfg.get("timeout"), 10)
    retries = _int(cfg.get("retries"), 2)

    use_ssl = _bool(cfg.get("use_ssl"), False)
    use_tls = _bool(cfg.get("use_tls"), True) and not use_ssl  # don't STARTTLS on SMTPS

    email = EmailMessage()
    email["From"] = sender
    email["To"] = recipient
    email["Subject"] = subject
    if cfg.get("reply_to"):
        email["Reply-To"] = str(cfg.get("reply_to"))

    # Provide both plain-text and HTML
    email.set_content(message)
    if html:
        email.add_alternative(html, subtype="html")

    ctx = ssl.create_default_context()
    last_exc: Exception | None = None

    for attempt in range(retries + 1):
        try:
            if use_ssl:
                with smtplib.SMTP_SSL(host, port, timeout=timeout, context=ctx) as smtp:
                    if username and password:
                        smtp.login(username, password)
                    smtp.send_message(email)
            else:
                with smtplib.SMTP(host, port, timeout=timeout) as smtp:
                    smtp.ehlo()
                    if use_tls:
                        smtp.starttls(context=ctx)
                        smtp.ehlo()
                    if username and password:
                        smtp.login(username, password)
                    smtp.send_message(email)
            return
        except Exception as exc:  # pragma: no cover - defensive
            last_exc = exc
            # small backoff: 0.5s, 1s, 2s...
            time.sleep(0.5 * (2**attempt))

    current_app.logger.warning("Unable to send email notification: %s", last_exc)


def send_email_async(
    recipient: str,
    subject: str,
    message: str,
    *,
    html: str | None = None,
) -> None:
    """Send email in background when enabled."""
    cfg = _get_email_config()
    async_enabled = _bool(cfg.get("async"), True)

    if not async_enabled:
        send_email(recipient, subject, message, html=html)
        return

    # Preserve app context in worker for logging/config access.
    app = current_app._get_current_object()

    def _work():
        with app.app_context():
            send_email(recipient, subject, message, html=html)

    try:
        _get_email_pool().submit(_work)
    except Exception:
        # fallback to sync if pool is not available
        send_email(recipient, subject, message, html=html)


# Keep the old internal name used by _dispatch_notifications.
def _send_email(recipient: str, subject: str, message: str) -> None:
    send_email_async(recipient, subject, message)


def _iter_unique_users(users: Sequence["User"]) -> Iterable["User"]:
    seen: set[int] = set()
    for user in users:
        if not user or not getattr(user, "id", None):
            continue
        if user.id in seen:
            continue
        seen.add(user.id)
        yield user


def _format_task_summary(task: "Task") -> str:
    base = f"任務：{task.title}"
    if task.description:
        base += f"\n內容：{task.description}"
    if getattr(task, "status", None):
        base += f"\n狀態：{task.status}"
    if task.location:
        base += f"\n地點：{task.location}"
    if task.expected_time:
        base += f"\n預計完成時間：{task.expected_time.isoformat()}"
    return base


def _dispatch_notifications(
    users: Sequence["User"],
    subject: str,
    message: str,
    *,
    email_kind: str | None = None,
    email_status: str | None = None,
    html: str | None = None,
    task: "Task" | None = None,
) -> None:
    resolved_message = _append_task_link(message, task) if task is not None else message
    resolved_subject = _email_subject(subject)

    for user in _iter_unique_users(users):
        if user.notification_type == "line" and user.notification_value:
            _send_line_notify(user.notification_value, resolved_message)
        elif user.notification_type == "email" and user.notification_value:
            if not _should_send_email(email_kind, status=email_status):
                continue
            send_email_async(
                user.notification_value,
                resolved_subject,
                resolved_message,
                html=html,
            )


def notify_task_assignment(task: "Task", users: Sequence["User"], *, assigned_by: "User" | None = None) -> None:
    if not users:
        return
    actor = f"{assigned_by.username} 指派給你一個任務" if assigned_by else "你被指派了一個任務"
    summary = _format_task_summary(task)
    message = f"{actor}。\n{summary}"
    _dispatch_notifications(users, "任務指派通知", message, email_kind="assignment", task=task)


def notify_task_status_change(
    task: "Task",
    users: Sequence["User"],
    *,
    updated_by: "User" | None = None,
) -> None:
    if not users:
        return
    actor = f"{updated_by.username} 更新了任務狀態" if updated_by else "任務狀態已更新"
    summary = _format_task_summary(task)
    message = f"{actor}。\n{summary}"
    _dispatch_notifications(users, "任務狀態更新", message, email_kind="status_change", email_status=getattr(task, "status", None), task=task)
