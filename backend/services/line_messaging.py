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
# backend/services/line_messaging.py

from typing import Optional

try:
    from flask import current_app
except Exception:
    current_app = None


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
    """
    True if LINE Messaging API config exists.
    Adjust env/config keys to match your project.
    """
    token = _cfg("LINE_CHANNEL_ACCESS_TOKEN", app=app)
    secret = _cfg("LINE_CHANNEL_SECRET", app=app)
    return bool(token and secret)


# 保險：如果你 auth.py 也 import push_text，但你服務沒定義，就補一個 noop
def push_text(to_user_id: str, text: str, app=None) -> bool:
    """
    Push a text message via LINE.
    If not configured, return False (do not raise).
    """
    if not has_line_config(app=app):
        return False

    # 這裡根據你原本的實作調整：
    # - 若你已經有 linebot SDK 的 push_message，就改成呼叫它
    # - 若沒有，先用 requests 打 LINE Messaging API
    import requests

    token = _cfg("LINE_CHANNEL_ACCESS_TOKEN", app=app)
    url = "https://api.line.me/v2/bot/message/push"
    payload = {"to": to_user_id, "messages": [{"type": "text", "text": text}]}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    r = requests.post(url, json=payload, headers=headers, timeout=10)
    return r.status_code // 100 == 2


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
