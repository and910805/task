from __future__ import annotations

import base64
import hashlib
import hmac
import os
from typing import Any

import requests
from flask import current_app

LINE_API_BASE = "https://api.line.me/v2/bot/message"
_MAX_TEXT_LEN = 1800


def has_line_bot_config() -> bool:
    """Return True if the LINE Messaging API token is configured."""
    return bool((os.getenv("LINE_CHANNEL_ACCESS_TOKEN") or "").strip())


def _headers() -> dict[str, str]:
    token = (os.getenv("LINE_CHANNEL_ACCESS_TOKEN") or "").strip()
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def verify_signature(body: bytes, signature: str, channel_secret: str) -> bool:
    """Verify X-Line-Signature (HMAC-SHA256 base64)."""
    if not signature or not channel_secret:
        return False
    mac = hmac.new(channel_secret.encode("utf-8"), body, hashlib.sha256).digest()
    expected = base64.b64encode(mac).decode("utf-8")
    return hmac.compare_digest(expected, signature)


def _truncate_text(text: str) -> str:
    text = text or ""
    if len(text) <= _MAX_TEXT_LEN:
        return text
    return text[: _MAX_TEXT_LEN - 1] + "…"


def reply_text(reply_token: str, text: str) -> None:
    """Reply to a webhook event."""
    if not has_line_bot_config() or not reply_token:
        return
    url = f"{LINE_API_BASE}/reply"
    payload: dict[str, Any] = {
        "replyToken": reply_token,
        "messages": [{"type": "text", "text": _truncate_text(text)}],
    }
    try:
        r = requests.post(url, headers=_headers(), json=payload, timeout=10)
        if r.status_code >= 400:
            current_app.logger.warning("LINE reply failed: %s %s", r.status_code, r.text)
    except Exception as exc:  # pragma: no cover
        current_app.logger.warning("LINE reply exception: %s", exc)


def push_text(to_user_id: str, text: str) -> None:
    """Push a text message to a LINE userId (starts with 'U')."""
    if not has_line_bot_config() or not to_user_id:
        return
    url = f"{LINE_API_BASE}/push"
    payload: dict[str, Any] = {
        "to": to_user_id,
        "messages": [{"type": "text", "text": _truncate_text(text)}],
    }
    try:
        r = requests.post(url, headers=_headers(), json=payload, timeout=10)
        if r.status_code >= 400:
            current_app.logger.warning("LINE push failed: %s %s", r.status_code, r.text)
    except Exception as exc:  # pragma: no cover
        current_app.logger.warning("LINE push exception: %s", exc)
