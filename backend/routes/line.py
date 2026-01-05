from __future__ import annotations

import json
import os
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from extensions import db
from models import SiteSetting, User
from services.line_messaging import reply_text, verify_signature

line_bp = Blueprint("line", __name__)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.rstrip("Z"))
    except Exception:
        return None


def _help_text() -> str:
    return (
        "可用指令：\n"
        "1) bind <綁定碼>  → 綁定網站帳號\n"
        "2) unbind        → 解除綁定\n\n"
        "綁定碼請到網站『個人資料』產生。"
    )


def _verify_request() -> bool:
    # If LINE_CHANNEL_SECRET is not set, skip verification (useful for local dev).
    secret = (os.getenv("LINE_CHANNEL_SECRET") or "").strip()
    if not secret:
        return True
    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data() or b""
    return verify_signature(body, signature, secret)


def _handle_bind(line_user_id: str, reply_token: str, code: str) -> None:
    key = f"line_bind:{code}"
    record = SiteSetting.get_record(key)
    if record is None:
        reply_text(reply_token, "綁定碼不存在或已過期，請回到網站重新產生。")
        return

    try:
        payload = json.loads(record.value or "{}")
    except Exception:
        payload = {}

    user_id = payload.get("user_id")
    expires_at = _parse_dt(payload.get("expires_at"))

    if expires_at and expires_at < datetime.utcnow():
        SiteSetting.delete_value(key)
        reply_text(reply_token, "綁定碼已過期，請回到網站重新產生。")
        return

    user = User.query.get(user_id) if user_id else None
    if user is None:
        SiteSetting.delete_value(key)
        reply_text(reply_token, "找不到對應帳號，請回到網站重新產生。")
        return

    user.notification_type = "line"
    user.notification_value = line_user_id
    db.session.commit()

    SiteSetting.delete_value(key)
    reply_text(reply_token, f"✅ 綁定完成！已連結到帳號：{user.username}")


def _handle_unbind(line_user_id: str, reply_token: str) -> None:
    user = User.query.filter_by(notification_type="line", notification_value=line_user_id).first()
    if user is None:
        reply_text(reply_token, "目前沒有綁定任何帳號。")
        return

    user.notification_type = None
    user.notification_value = None
    db.session.commit()
    reply_text(reply_token, "✅ 已解除綁定。")


@line_bp.post("/webhook")
def webhook():
    if not _verify_request():
        return jsonify({"msg": "invalid signature"}), 400

    payload = request.get_json(silent=True) or {}
    events = payload.get("events") or []

    for event in events:
        try:
            reply_token = event.get("replyToken")
            source = event.get("source") or {}
            line_user_id = source.get("userId")
            if not reply_token or not line_user_id:
                continue

            etype = event.get("type")
            if etype == "follow":
                reply_text(reply_token, _help_text())
                continue

            if etype != "message":
                continue

            message = event.get("message") or {}
            if message.get("type") != "text":
                continue

            text = (message.get("text") or "").strip()
            lower = text.lower()

            if lower.startswith("bind "):
                code = text.split(None, 1)[1].strip()
                _handle_bind(line_user_id, reply_token, code)
            elif lower in {"unbind", "解除", "解除綁定"}:
                _handle_unbind(line_user_id, reply_token)
            elif lower in {"help", "?", "指令", "幫助"}:
                reply_text(reply_token, _help_text())
        except Exception as exc:  # pragma: no cover
            current_app.logger.warning("LINE webhook error: %s", exc)

    return jsonify({"ok": True})
