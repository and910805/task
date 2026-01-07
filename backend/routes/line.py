from __future__ import annotations

import json
import os
from datetime import datetime
from io import BytesIO
from typing import Optional

from flask import Blueprint, current_app, jsonify, request
from werkzeug.datastructures import FileStorage

from extensions import db
from models import SiteSetting, User, Task, TaskUpdate
from services.attachments import create_file_attachment
from services.line_messaging import (
    reply_text,
    verify_signature,
    get_message_content_bytes,
)

line_bp = Blueprint("line", __name__)

PENDING_PREFIX = "line_pending:"


def _cfg(key: str) -> Optional[str]:
    """Read from Flask config first, fallback to env."""
    try:
        val = current_app.config.get(key)
        if val:
            return str(val)
    except Exception:
        pass
    return os.getenv(key)


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
        "2) unbind        → 解除綁定\n"
        "3) tasks         → 列出指派給我的任務\n"
        "4) accept <id>   → 接單（尚未接單且未指派）\n"
        "5) start <id>    → 設為進行中\n"
        "6) done <id> <說明> → 完工（會要求傳照片）\n\n"
        "綁定碼請到網站『個人資料』產生。"
    )


def _verify_request() -> bool:
    """
    Verify LINE webhook signature.

    More stable:
    - Prefer current_app.config['LINE_CHANNEL_SECRET'] if present
    - Fallback to env
    - If secret is empty -> skip verification (useful for local dev)
    """
    secret = (_cfg("LINE_CHANNEL_SECRET") or "").strip()
    if not secret:
        # local dev / intentionally disabled
        return True

    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data() or b""
    return verify_signature(body, signature, secret)


def _pending_key(line_user_id: str) -> str:
    return f"{PENDING_PREFIX}{line_user_id}"


def _get_pending(line_user_id: str) -> dict | None:
    record = SiteSetting.get_record(_pending_key(line_user_id))
    if record is None or not (record.value or "").strip():
        return None
    try:
        return json.loads(record.value)
    except Exception:
        return None


def _set_pending(line_user_id: str, payload: dict) -> None:
    SiteSetting.set_value(
        _pending_key(line_user_id),
        json.dumps(payload, ensure_ascii=False),
    )


def _clear_pending(line_user_id: str) -> None:
    SiteSetting.delete_value(_pending_key(line_user_id))


def _get_bound_user(line_user_id: str) -> User | None:
    return User.query.filter_by(
        notification_type="line",
        notification_value=line_user_id,
    ).first()


def _worker_can_access_task(task: Task, user_id: int) -> bool:
    # 單一指派
    if getattr(task, "assigned_to_id", None) == user_id:
        return True
    # 多重指派
    for a in (getattr(task, "assignees", None) or []):
        if getattr(a, "user_id", None) == user_id:
            return True
    return False


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
    user = _get_bound_user(line_user_id)
    if user is None:
        reply_text(reply_token, "目前沒有綁定任何帳號。")
        return

    user.notification_type = None
    user.notification_value = None
    db.session.commit()
    reply_text(reply_token, "✅ 已解除綁定。")


def _handle_text_command(line_user_id: str, reply_token: str, text: str) -> None:
    user = _get_bound_user(line_user_id)
    if user is None:
        reply_text(reply_token, "你尚未綁定帳號，請先輸入：bind <綁定碼>")
        return

    t = (text or "").strip()

    if t == "tasks":
        tasks = (
            Task.query.filter(
                (Task.assigned_to_id == user.id) | Task.assignees.any(user_id=user.id)
            )
            .order_by(Task.id.desc())
            .limit(10)
            .all()
        )
        if not tasks:
            reply_text(reply_token, "目前沒有指派給你的任務。")
            return

        msg = "你的任務（最近10筆）：\n" + "\n".join(
            [f"- #{x.id} [{x.status}] {x.title}" for x in tasks]
        )
        reply_text(reply_token, msg)
        return

    if t.startswith("start "):
        parts = t.split()
        if len(parts) != 2 or not parts[1].isdigit():
            reply_text(reply_token, "用法：start <task_id>")
            return

        task_id = int(parts[1])
        task = Task.query.get(task_id)
        if task is None:
            reply_text(reply_token, "找不到任務")
            return

        if not _worker_can_access_task(task, user.id):
            reply_text(reply_token, "你沒有權限操作這個任務")
            return

        db.session.add(
            TaskUpdate(task_id=task.id, user_id=user.id, status="進行中", note=None)
        )
        task.status = "進行中"
        task.updated_at = datetime.utcnow()
        db.session.commit()

        reply_text(reply_token, f"已將任務 #{task.id} 設為「進行中」。")
        return

    if t.startswith("accept "):
        parts = t.split()
        if len(parts) != 2 or not parts[1].isdigit():
            reply_text(reply_token, "用法：accept <task_id>")
            return

        if user.role != "worker":
            reply_text(reply_token, "只有工人可以接單。")
            return

        task_id = int(parts[1])
        now = datetime.utcnow()
        updated = (
            Task.query.filter(
                Task.id == task_id,
                Task.status == "尚未接單",
                Task.assigned_to_id.is_(None),
            )
            .update(
                {
                    "assigned_to_id": user.id,
                    "status": "已接單",
                    "updated_at": now,
                },
                synchronize_session=False,
            )
        )

        if updated == 0:
            task = Task.query.get(task_id)
            if task is None:
                reply_text(reply_token, "找不到任務")
                return
            reply_text(reply_token, "任務已被接走或狀態不符合接單條件。")
            return

        db.session.add(TaskUpdate(task_id=task_id, user_id=user.id, status="已接單", note=None))
        db.session.commit()
        reply_text(reply_token, f"已接單任務 #{task_id} ✅")
        return

    if t.startswith("done "):
        parts = t.split(maxsplit=2)
        if len(parts) < 3 or not parts[1].isdigit():
            reply_text(reply_token, "用法：done <task_id> <說明>")
            return

        task_id = int(parts[1])
        note = (parts[2] or "").strip()
        if not note:
            reply_text(reply_token, "完成任務需要說明。用法：done <task_id> <說明>")
            return

        task = Task.query.get(task_id)
        if task is None:
            reply_text(reply_token, "找不到任務")
            return

        if not _worker_can_access_task(task, user.id):
            reply_text(reply_token, "你沒有權限操作這個任務")
            return

        # ✅ 先進入 pending，等待照片
        _set_pending(line_user_id, {"task_id": task_id, "note": note, "need_photo": True})
        reply_text(
            reply_token,
            f"OK！請直接傳「照片」給我（任務 #{task_id} 完工需要至少 1 張照片）。",
        )
        return

    reply_text(reply_token, _help_text())


def _handle_image_message(line_user_id: str, reply_token: str, message_id: str) -> None:
    user = _get_bound_user(line_user_id)
    if user is None:
        reply_text(reply_token, "你尚未綁定帳號，請先輸入：bind <綁定碼>")
        return

    pending = _get_pending(line_user_id)
    if not pending or not pending.get("need_photo"):
        reply_text(
            reply_token,
            "我收到照片了，但你目前沒有待處理的完工流程。\n如要完工請輸入：done <task_id> <說明>",
        )
        return

    task_id = int(pending["task_id"])
    note = (pending.get("note") or "").strip()

    task = Task.query.get(task_id)
    if task is None:
        _clear_pending(line_user_id)
        reply_text(reply_token, "找不到任務，已清除待處理狀態。")
        return

    if not _worker_can_access_task(task, user.id):
        _clear_pending(line_user_id)
        reply_text(reply_token, "你沒有權限操作這個任務，已清除待處理狀態。")
        return

    # 1) 抓 LINE 圖片 bytes
    try:
        data, content_type = get_message_content_bytes(message_id)
    except Exception as exc:
        current_app.logger.warning("LINE image fetch failed: %s", exc)
        reply_text(reply_token, "下載照片失敗，請稍後再傳一次。")
        return

    filename = f"line_{line_user_id}_{message_id}.jpg"

    # 2) 存成附件（走與 uploads 相同的 create_file_attachment）
    fs = FileStorage(
        stream=BytesIO(data),
        filename=filename,
        content_type=content_type or "image/jpeg",
    )

    try:
        create_file_attachment(task, user_id=user.id, uploaded_file=fs, file_type="image", note=None)
    except Exception as exc:
        current_app.logger.warning("Save attachment failed: %s", exc)
        reply_text(reply_token, "照片儲存失敗，請稍後再試。")
        return

    # 3) 寫 update + 設完成
    db.session.add(TaskUpdate(task_id=task.id, user_id=user.id, status="已完成", note=note))
    task.status = "已完成"
    task.completed_at = task.completed_at or datetime.utcnow()
    task.updated_at = datetime.utcnow()
    db.session.commit()

    _clear_pending(line_user_id)
    reply_text(reply_token, f"已完成任務 #{task.id} ✅（照片已存、說明已記錄）")


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
            mtype = message.get("type")

            if mtype == "text":
                text = (message.get("text") or "").strip()
                lower = text.lower()

                if lower.startswith("bind "):
                    code = text.split(None, 1)[1].strip()
                    _handle_bind(line_user_id, reply_token, code)
                elif lower in {"unbind", "解除", "解除綁定"}:
                    _handle_unbind(line_user_id, reply_token)
                elif lower in {"help", "?", "指令", "幫助", "menu", "功能", "功能表"}:
                    reply_text(reply_token, _help_text())
                else:
                    _handle_text_command(line_user_id, reply_token, text)

            elif mtype == "image":
                message_id = message.get("id")
                if message_id:
                    _handle_image_message(line_user_id, reply_token, message_id)

        except Exception as exc:  # pragma: no cover
            current_app.logger.warning("LINE webhook error: %s", exc)

    return jsonify({"ok": True})
