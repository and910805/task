from __future__ import annotations

import base64
import hashlib
import hmac
import os
from typing import Any, Optional, Tuple

import requests

try:
    from flask import current_app
except Exception:
    current_app = None


LINE_API_BASE = "https://api.line.me/v2/bot/message"
LINE_DATA_API_BASE = "https://api-data.line.me/v2/bot/message"
_MAX_TEXT_LEN = 1800


def _cfg(key: str, app=None) -> Optional[str]:
    """Get config from Flask app.config first, fallback to env."""
    if app is not None:
        return app.config.get(key) or os.getenv(key)

    if current_app is not None:
        try:
            return current_app.config.get(key) or os.getenv(key)
        except Exception:
            pass

    return os.getenv(key)


def has_line_config(app=None) -> bool:
    """True if both LINE token & secret exist."""
    token = (_cfg("LINE_CHANNEL_ACCESS_TOKEN", app=app) or "").strip()
    secret = (_cfg("LINE_CHANNEL_SECRET", app=app) or "").strip()
    return bool(token and secret)


def has_line_bot_config(app=None) -> bool:
    """True if LINE Messaging API access token exists."""
    token = (_cfg("LINE_CHANNEL_ACCESS_TOKEN", app=app) or "").strip()
    return bool(token)


def _headers(app=None, *, json_content: bool = True) -> dict[str, str]:
    token = (_cfg("LINE_CHANNEL_ACCESS_TOKEN", app=app) or "").strip()
    headers = {"Authorization": f"Bearer {token}"}
    if json_content:
        headers["Content-Type"] = "application/json"
    return headers


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


def reply_text(reply_token: str, text: str, app=None) -> bool:
    """Reply to a webhook event. Return True if 2xx."""
    if not has_line_bot_config(app=app) or not reply_token:
        return False

    url = f"{LINE_API_BASE}/reply"
    payload: dict[str, Any] = {
        "replyToken": reply_token,
        "messages": [{"type": "text", "text": _truncate_text(text)}],
    }

    try:
        r = requests.post(url, headers=_headers(app=app), json=payload, timeout=10)
        if r.status_code >= 400 and current_app is not None:
            current_app.logger.warning("LINE reply failed: %s %s", r.status_code, r.text)
        return r.status_code // 100 == 2
    except Exception as exc:  # pragma: no cover
        if current_app is not None:
            current_app.logger.warning("LINE reply exception: %s", exc)
        return False


def push_text(to_user_id: str, text: str, app=None) -> bool:
    """Push a text message to a LINE userId (starts with 'U'). Return True if 2xx."""
    if not has_line_bot_config(app=app) or not to_user_id:
        return False

    url = f"{LINE_API_BASE}/push"
    payload: dict[str, Any] = {
        "to": to_user_id,
        "messages": [{"type": "text", "text": _truncate_text(text)}],
    }

    try:
        r = requests.post(url, headers=_headers(app=app), json=payload, timeout=10)
        if r.status_code >= 400 and current_app is not None:
            current_app.logger.warning("LINE push failed: %s %s", r.status_code, r.text)
        return r.status_code // 100 == 2
    except Exception as exc:  # pragma: no cover
        if current_app is not None:
            current_app.logger.warning("LINE push exception: %s", exc)
        return False


def get_message_content_bytes(message_id: str, app=None) -> Tuple[bytes, str]:
    """
    Fetch binary content (image/audio/video) from LINE message content API.

    Returns:
      (content_bytes, content_type)

    Requires:
      LINE_CHANNEL_ACCESS_TOKEN in env or app.config
    """
    if not has_line_bot_config(app=app):
        raise RuntimeError("LINE_CHANNEL_ACCESS_TOKEN not set")

    url = f"{LINE_DATA_API_BASE}/{message_id}/content"
    # 注意：抓 binary 時不要強制 Content-Type: application/json
    headers = _headers(app=app, json_content=False)

    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()

    content_type = r.headers.get("Content-Type", "application/octet-stream")
    return r.content, content_type
