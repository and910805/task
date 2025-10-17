"""Utility helpers for delivering task notifications."""

from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from typing import Iterable, Sequence

import requests
from flask import current_app


LINE_NOTIFY_ENDPOINT = "https://notify-api.line.me/api/notify"


def _send_line_notify(token: str, message: str) -> None:
    if not token:
        return
    headers = {"Authorization": f"Bearer {token}"}
    data = {"message": message}
    try:
        response = requests.post(LINE_NOTIFY_ENDPOINT, headers=headers, data=data, timeout=10)
        if response.status_code >= 400:
            current_app.logger.warning(
                "LINE Notify request failed: status=%s body=%s",
                response.status_code,
                response.text,
            )
    except Exception as exc:  # pragma: no cover - defensive
        current_app.logger.warning("Unable to send LINE notification: %s", exc)


def _get_email_config() -> dict[str, str | int | None]:
    config = {
        "host": os.getenv("EMAIL_SMTP_HOST") or current_app.config.get("EMAIL_SMTP_HOST"),
        "port": os.getenv("EMAIL_SMTP_PORT") or current_app.config.get("EMAIL_SMTP_PORT"),
        "username": os.getenv("EMAIL_SMTP_USERNAME")
        or current_app.config.get("EMAIL_SMTP_USERNAME"),
        "password": os.getenv("EMAIL_SMTP_PASSWORD")
        or current_app.config.get("EMAIL_SMTP_PASSWORD"),
        "sender": os.getenv("EMAIL_SENDER") or current_app.config.get("EMAIL_SENDER"),
        "use_tls": os.getenv("EMAIL_SMTP_USE_TLS")
        or current_app.config.get("EMAIL_SMTP_USE_TLS", "true"),
    }
    return config


def _send_email(recipient: str, subject: str, message: str) -> None:
    config = _get_email_config()
    host = config.get("host")
    sender = config.get("sender")
    if not host or not sender:
        current_app.logger.info(
            "Email notification skipped because SMTP settings are incomplete"
        )
        return

    port_raw = config.get("port")
    port = int(port_raw) if port_raw else 587
    username = config.get("username")
    password = config.get("password")
    use_tls_raw = config.get("use_tls")
    use_tls = str(use_tls_raw).lower() not in {"0", "false", "no"}

    email = EmailMessage()
    email["From"] = sender
    email["To"] = recipient
    email["Subject"] = subject
    email.set_content(message)

    try:
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            if use_tls:
                smtp.starttls()
            if username and password:
                smtp.login(username, password)
            smtp.send_message(email)
    except Exception as exc:  # pragma: no cover - defensive
        current_app.logger.warning("Unable to send email notification: %s", exc)


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
    base = f"任務「{task.title}」目前狀態：{task.status}"
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
    actor = f"由 {assigned_by.username} 指派" if assigned_by else ""
    summary = _format_task_summary(task)
    message = f"您被指派負責{task.title}。\n{summary}"
    if actor:
        message = f"{actor}\n{message}"
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
