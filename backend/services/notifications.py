"""Utility helpers for delivering task notifications."""

from __future__ import annotations

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


def _dispatch_notifications(users: Sequence["User"], subject: str, message: str) -> None:
    for user in _iter_unique_users(users):
        if user.notification_type == "line" and user.notification_value:
            _send_line_notify(user.notification_value, message)
        elif user.notification_type == "email" and user.notification_value:
            _send_email(user.notification_value, subject, message)


def notify_task_assignment(task: "Task", users: Sequence["User"], *, assigned_by: "User" | None = None) -> None:
    if not users:
        return
    actor = f"{assigned_by.username} 指派給你一個任務" if assigned_by else "你被指派了一個任務"
    summary = _format_task_summary(task)
    message = f"{actor}。\n{summary}"
    _dispatch_notifications(users, "任務指派通知", message)


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
    _dispatch_notifications(users, "任務狀態更新", message)
