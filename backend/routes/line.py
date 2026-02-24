from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from io import BytesIO
from typing import Optional
from urllib.parse import parse_qs

from flask import Blueprint, current_app, jsonify, request
from werkzeug.datastructures import FileStorage

from decorators import role_required
from extensions import db
from models import SiteSetting, User, Task, TaskUpdate
from services.attachments import create_file_attachment
from services.line_messaging import (
    build_default_rich_menu,
    create_rich_menu,
    delete_rich_menu,
    has_line_bot_config,
    list_rich_menus,
    reply_messages,
    reply_text,
    set_default_rich_menu,
    upload_rich_menu_image,
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


def _week_range_dates(now: datetime | None = None) -> tuple[datetime, datetime]:
    base = now or datetime.utcnow()
    start = datetime(base.year, base.month, base.day) - timedelta(days=base.weekday())
    end_exclusive = start + timedelta(days=7)
    return start, end_exclusive


def _fmt_line_dt_short(value: datetime | None) -> str:
    if not value:
        return "--:--"
    try:
        return value.strftime("%m/%d %H:%M")
    except Exception:
        return str(value)


def _build_week_schedule_flex(tasks: list[Task], week_start: datetime) -> dict:
    day_keys = [week_start + timedelta(days=i) for i in range(7)]
    grouped: dict[str, list[Task]] = {d.strftime("%Y-%m-%d"): [] for d in day_keys}

    for task in tasks:
        dt = getattr(task, "expected_time", None) or getattr(task, "due_date", None)
        if not dt:
            continue
        key = dt.strftime("%Y-%m-%d")
        if key in grouped:
            grouped[key].append(task)

    day_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    day_boxes: list[dict] = []
    for idx, day_dt in enumerate(day_keys):
        day_key = day_dt.strftime("%Y-%m-%d")
        entries = sorted(
            grouped.get(day_key, []),
            key=lambda t: (
                getattr(t, "expected_time", None) or getattr(t, "due_date", None) or datetime.max,
                getattr(t, "id", 0),
            ),
        )

        contents: list[dict] = [
            {
                "type": "box",
                "layout": "baseline",
                "contents": [
                    {
                        "type": "text",
                        "text": day_labels[idx],
                        "size": "sm",
                        "weight": "bold",
                        "color": "#111827",
                        "flex": 2,
                    },
                    {
                        "type": "text",
                        "text": day_dt.strftime("%m/%d"),
                        "size": "xs",
                        "color": "#6B7280",
                        "align": "end",
                        "flex": 3,
                    },
                ],
            }
        ]

        if not entries:
            contents.append(
                {
                    "type": "text",
                    "text": "No tasks",
                    "size": "xs",
                    "color": "#9CA3AF",
                    "wrap": True,
                    "margin": "xs",
                }
            )
        else:
            for task in entries[:2]:
                when = _fmt_line_dt_short(getattr(task, "expected_time", None) or getattr(task, "due_date", None))
                status = str(getattr(task, "status", "") or "")
                title = str(getattr(task, "title", "") or "").strip() or "(untitled)"
                line = f"{when} [{status}] {title}"
                if len(line) > 42:
                    line = line[:41] + "…"
                contents.append(
                    {
                        "type": "text",
                        "text": line,
                        "size": "xs",
                        "color": "#1F2937",
                        "wrap": True,
                        "margin": "xs",
                    }
                )
            if len(entries) > 2:
                contents.append(
                    {
                        "type": "text",
                        "text": f"+{len(entries) - 2} more",
                        "size": "xs",
                        "color": "#10B981",
                        "margin": "xs",
                    }
                )

        day_boxes.append(
            {
                "type": "box",
                "layout": "vertical",
                "spacing": "xs",
                "paddingAll": "8px",
                "backgroundColor": "#F9FAFB",
                "cornerRadius": "8px",
                "margin": "sm",
                "contents": contents,
            }
        )

    range_text = f"{week_start.strftime('%m/%d')} - {(week_start + timedelta(days=6)).strftime('%m/%d')}"
    footer_contents: list[dict] = []
    base = (_cfg("APP_BASE_URL") or "").strip().rstrip("/")
    if base:
        footer_contents.append(
            {
                "type": "button",
                "style": "link",
                "height": "sm",
                "action": {"type": "uri", "label": "Open Web", "uri": f"{base}/tasks"},
            }
        )

    return {
        "type": "flex",
        "altText": f"This week schedule {range_text}",
        "contents": {
            "type": "bubble",
            "size": "giga",
            "header": {
                "type": "box",
                "layout": "vertical",
                "paddingAll": "12px",
                "backgroundColor": "#EEF2FF",
                "contents": [
                    {
                        "type": "text",
                        "text": "This Week Schedule",
                        "weight": "bold",
                        "size": "md",
                        "color": "#111827",
                    },
                    {
                        "type": "text",
                        "text": range_text,
                        "size": "xs",
                        "color": "#4B5563",
                        "margin": "xs",
                    },
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "none",
                "contents": day_boxes,
            },
            **({"footer": {"type": "box", "layout": "vertical", "contents": footer_contents}} if footer_contents else {}),
        },
    }


def _handle_week_schedule(line_user_id: str, reply_token: str) -> None:
    user = _get_bound_user(line_user_id)
    if user is None:
        reply_text(reply_token, "Please bind your account first. Use: bind <code>")
        return

    week_start, week_end_exclusive = _week_range_dates()
    tasks = (
        Task.query.filter(
            ((Task.assigned_to_id == user.id) | Task.assignees.any(user_id=user.id))
            & (Task.expected_time.isnot(None))
            & (Task.expected_time >= week_start)
            & (Task.expected_time < week_end_exclusive)
        )
        .order_by(Task.expected_time.asc(), Task.id.asc())
        .all()
    )

    if not tasks:
        reply_text(
            reply_token,
            f"This week ({week_start.strftime('%m/%d')}-{(week_start + timedelta(days=6)).strftime('%m/%d')}) has no scheduled tasks.",
        )
        return

    if not reply_messages(reply_token, [_build_week_schedule_flex(tasks, week_start)]):
        reply_text(reply_token, "Unable to render weekly schedule card. Try again later.")


def _help_text() -> str:
    return (
        "可用指令：\n"
        "1) bind <綁定碼>  → 綁定網站帳號\n"
        "2) unbind        → 解除綁定\n"
        "3) tasks         → 列出指派給我的任務\n"
        "4) accept <id>   → 接單（尚未接單且未指派）\n"
        "5) start <id>    → 設為進行中\n"
        "6) done <id> <說明> → 完工（會要求傳照片）\n\n"
        "進階指令（可選）：\n"
        "- stop <id>              → 結束工時\n"
        "- timer-start <id>       → 開始工時（文字版）\n"
        "- timer-stop <id>        → 結束工時（文字版）\n"
        "- reject <id> <原因>      → 回報無法接單\n"
        "- week / calendar / 本週  → 顯示本週工作行程\n\n"
        "綁定碼請到網站『個人資料』產生。\n"
        "任務卡片也可以直接按按鈕操作（接受 / 拒絕 / 開始工時 / 結束工時）。"
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


def _parse_postback_data(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    try:
        parsed = parse_qs(str(raw), keep_blank_values=False)
    except Exception:
        return {}
    data: dict[str, str] = {}
    for key, values in parsed.items():
        if not values:
            continue
        data[str(key)] = str(values[0])
    return data


def _line_time_start(task: Task, user: User) -> tuple[bool, str]:
    if not _worker_can_access_task(task, user.id):
        return False, "You do not have access to this task."

    active_entry = (
        TaskUpdate.query.filter_by(task_id=task.id, user_id=user.id)
        .filter(TaskUpdate.start_time.isnot(None), TaskUpdate.end_time.is_(None))
        .order_by(TaskUpdate.created_at.desc())
        .first()
    )
    if active_entry:
        return False, f"Task #{task.id}: timer is already running."

    now = datetime.utcnow()
    entry = TaskUpdate(
        task_id=task.id,
        user_id=user.id,
        start_time=now,
        status="進行中",
    )
    task.updated_at = now
    db.session.add(entry)
    db.session.commit()
    return True, f"Task #{task.id}: timer started."


def _line_time_stop(task: Task, user: User) -> tuple[bool, str]:
    if not _worker_can_access_task(task, user.id):
        return False, "You do not have access to this task."

    active_entry = (
        TaskUpdate.query.filter_by(task_id=task.id, user_id=user.id)
        .filter(TaskUpdate.start_time.isnot(None), TaskUpdate.end_time.is_(None))
        .order_by(TaskUpdate.created_at.desc())
        .first()
    )
    if not active_entry:
        return False, f"Task #{task.id}: no running timer found."

    now = datetime.utcnow()
    active_entry.end_time = now
    if active_entry.start_time:
        delta = now - active_entry.start_time
        active_entry.work_hours = round(delta.total_seconds() / 3600, 2)
    else:
        active_entry.work_hours = 0.0
    task.updated_at = now
    db.session.commit()
    hours = active_entry.work_hours if active_entry.work_hours is not None else 0.0
    return True, f"Task #{task.id}: timer stopped ({hours:.2f}h)."


def _line_accept_task(task: Task, user: User) -> tuple[bool, str]:
    if not _worker_can_access_task(task, user.id):
        return False, "你沒有此任務的權限。"

    now = datetime.utcnow()
    db.session.add(
        TaskUpdate(
            task_id=task.id,
            user_id=user.id,
            status=None,
            note="LINE 已接受任務",
        )
    )
    task.updated_at = now
    db.session.commit()
    return True, f"已接受任務 #{task.id}。"


def _line_reject_task(task: Task, user: User, reason: str) -> tuple[bool, str]:
    if not _worker_can_access_task(task, user.id):
        return False, "你沒有此任務的權限。"

    clean_reason = (reason or "").strip()
    if not clean_reason:
        return False, "請輸入無法接單原因。"

    now = datetime.utcnow()
    db.session.add(
        TaskUpdate(
            task_id=task.id,
            user_id=user.id,
            status=None,
            note=f"LINE 無法接單：{clean_reason}",
        )
    )
    task.updated_at = now
    db.session.commit()
    return True, f"已回報無法接單（任務 #{task.id}）。"


def _handle_postback(line_user_id: str, reply_token: str, raw_data: str | None) -> None:
    user = _get_bound_user(line_user_id)
    if user is None:
        reply_text(reply_token, "Please bind your account first. Use: bind <code>")
        return

    data = _parse_postback_data(raw_data)
    action = (data.get("a") or "").strip().lower()
    task_id_raw = (data.get("t") or "").strip()

    if action in {"accept", "task_accept", "reject_prompt", "task_start", "time_start", "time_stop"}:
        if not task_id_raw.isdigit():
            reply_text(reply_token, "Invalid task id.")
            return
        task_id = int(task_id_raw)
        task = Task.query.get(task_id)
        if task is None:
            reply_text(reply_token, "Task not found.")
            return

        if action == "accept":
            _handle_text_command(line_user_id, reply_token, f"accept {task_id}")
            return
        if action == "task_accept":
            _ok, msg = _line_accept_task(task, user)
            reply_text(reply_token, msg)
            return
        if action == "reject_prompt":
            if not _worker_can_access_task(task, user.id):
                reply_text(reply_token, "你沒有此任務的權限。")
                return
            _set_pending(
                line_user_id,
                {
                    "type": "reject_reason",
                    "task_id": task_id,
                    "created_at": datetime.utcnow().isoformat(),
                },
            )
            reply_text(
                reply_token,
                f"請輸入無法接單原因（任務 #{task_id}）。\n例如：臨時有案場 / 距離太遠 / 時間衝突\n輸入 取消 可取消。",
            )
            return
        if action == "task_start":
            _handle_text_command(line_user_id, reply_token, f"start {task_id}")
            return
        if action == "time_start":
            _ok, msg = _line_time_start(task, user)
            reply_text(reply_token, msg)
            return
        if action == "time_stop":
            _ok, msg = _line_time_stop(task, user)
            reply_text(reply_token, msg)
            return

    reply_text(reply_token, _help_text())


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
    lower_t = t.lower()

    pending = _get_pending(line_user_id)
    if pending and pending.get("type") == "reject_reason":
        if lower_t in {"cancel", "取消"}:
            _clear_pending(line_user_id)
            reply_text(reply_token, "已取消無法接單回報。")
            return

        task_id = pending.get("task_id")
        if not isinstance(task_id, int):
            try:
                task_id = int(task_id)
            except Exception:
                task_id = None
        if not task_id:
            _clear_pending(line_user_id)
            reply_text(reply_token, "任務資訊已失效，請重新操作。")
            return

        task = Task.query.get(task_id)
        if task is None:
            _clear_pending(line_user_id)
            reply_text(reply_token, f"任務 #{task_id} 不存在。")
            return

        ok, msg = _line_reject_task(task, user, t)
        if ok:
            _clear_pending(line_user_id)
        reply_text(reply_token, msg)
        return

    if lower_t in {"week", "calendar", "thisweek", "this-week"} or t in {"本週", "行事曆", "本周"}:
        _handle_week_schedule(line_user_id, reply_token)
        return

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

        def _format_task_line(task: Task) -> str:
            base = f"- #{task.id} [{task.status}] {task.title}"
            if task.location_url:
                base += f"\n  地圖：{task.location_url}"
            return base

        msg = "你的任務（最近10筆）：\n" + "\n".join(
            [_format_task_line(x) for x in tasks]
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

    if t.startswith("stop "):
        parts = t.split()
        if len(parts) != 2 or not parts[1].isdigit():
            reply_text(reply_token, "用法：stop <task_id>")
            return

        task_id = int(parts[1])
        task = Task.query.get(task_id)
        if task is None:
            reply_text(reply_token, "找不到任務")
            return

        _ok, msg = _line_time_stop(task, user)
        reply_text(reply_token, msg)
        return

    if (
        t.startswith("timer-start ")
        or t.startswith("tstart ")
        or t.startswith("工時開始 ")
    ):
        parts = t.split()
        if len(parts) != 2 or not parts[1].isdigit():
            reply_text(reply_token, "用法：timer-start <task_id>")
            return

        task_id = int(parts[1])
        task = Task.query.get(task_id)
        if task is None:
            reply_text(reply_token, "找不到任務")
            return

        _ok, msg = _line_time_start(task, user)
        reply_text(reply_token, msg)
        return

    if (
        t.startswith("timer-stop ")
        or t.startswith("tstop ")
        or t.startswith("工時結束 ")
    ):
        parts = t.split()
        if len(parts) != 2 or not parts[1].isdigit():
            reply_text(reply_token, "用法：timer-stop <task_id>")
            return

        task_id = int(parts[1])
        task = Task.query.get(task_id)
        if task is None:
            reply_text(reply_token, "找不到任務")
            return

        _ok, msg = _line_time_stop(task, user)
        reply_text(reply_token, msg)
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

    if t.startswith("reject "):
        parts = t.split(maxsplit=2)
        if len(parts) < 2 or not parts[1].isdigit():
            reply_text(reply_token, "用法：reject <task_id> <原因>")
            return

        task_id = int(parts[1])
        task = Task.query.get(task_id)
        if task is None:
            reply_text(reply_token, "找不到任務")
            return

        if len(parts) == 2 or not (parts[2] or "").strip():
            if not _worker_can_access_task(task, user.id):
                reply_text(reply_token, "你沒有此任務的權限。")
                return
            _set_pending(
                line_user_id,
                {
                    "type": "reject_reason",
                    "task_id": task_id,
                    "created_at": datetime.utcnow().isoformat(),
                },
            )
            reply_text(
                reply_token,
                f"請輸入無法接單原因（任務 #{task_id}）。\n或直接輸入：reject {task_id} <原因>",
            )
            return

        _ok, msg = _line_reject_task(task, user, parts[2])
        reply_text(reply_token, msg)
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


@line_bp.get("/rich-menu/template")
@role_required("admin")
def get_rich_menu_template():
    base_url = (_cfg("APP_BASE_URL") or "").strip().rstrip("/")
    menu = build_default_rich_menu(base_url=base_url or None)
    return jsonify(
        {
            "ok": True,
            "msg": "LINE Rich Menu default template",
            "image_requirements": {
                "width": 2500,
                "height": 1686,
                "format": ["image/png", "image/jpeg"],
            },
            "recommended_tiles": [
                "任務列表 (tasks)",
                "本週行程 (本週)",
                "功能說明 (help)",
                "任務頁面 (/app)",
                "個人資料 (/profile)",
                "行事曆 (/calendar)",
            ],
            "base_url": base_url or None,
            "menu": menu,
        }
    )


@line_bp.get("/rich-menu/list")
@role_required("admin")
def get_rich_menu_list():
    if not has_line_bot_config():
        return jsonify({"ok": False, "msg": "LINE Bot is not configured"}), 400
    try:
        data = list_rich_menus()
    except Exception as exc:
        return jsonify({"ok": False, "msg": f"LINE rich menu list failed: {exc}"}), 500
    return jsonify({"ok": True, **(data if isinstance(data, dict) else {"richmenus": []})})


@line_bp.post("/rich-menu/default")
@role_required("admin")
def create_default_rich_menu():
    """Create + upload + set default LINE Rich Menu using uploaded image."""
    if not has_line_bot_config():
        return jsonify({"ok": False, "msg": "LINE Bot is not configured"}), 400

    upload = request.files.get("file") or request.files.get("image")
    if upload is None:
        return (
            jsonify(
                {
                    "ok": False,
                    "msg": "Please upload image file via multipart/form-data field 'file' (or 'image').",
                }
            ),
            400,
        )

    filename = (upload.filename or "").strip()
    if not filename:
        return jsonify({"ok": False, "msg": "Image filename is required"}), 400

    content_type = (upload.content_type or "").strip().lower()
    if content_type not in {"image/png", "image/jpeg", "image/jpg"}:
        lower_name = filename.lower()
        if lower_name.endswith(".png"):
            content_type = "image/png"
        elif lower_name.endswith(".jpg") or lower_name.endswith(".jpeg"):
            content_type = "image/jpeg"
        else:
            return jsonify({"ok": False, "msg": "Only PNG/JPEG image is supported"}), 400

    image_bytes = upload.read()
    if not image_bytes:
        return jsonify({"ok": False, "msg": "Uploaded image is empty"}), 400

    base_url = (request.form.get("base_url") or _cfg("APP_BASE_URL") or "").strip().rstrip("/")
    chat_bar_text = (request.form.get("chat_bar_text") or "功能選單").strip() or "功能選單"
    menu_name = (request.form.get("menu_name") or "TaskGo Worker Menu").strip() or "TaskGo Worker Menu"

    menu = build_default_rich_menu(
        base_url=base_url or None,
        chat_bar_text=chat_bar_text,
    )
    menu["name"] = menu_name[:300]

    rich_menu_id = None
    try:
        rich_menu_id = create_rich_menu(menu)
        upload_rich_menu_image(rich_menu_id, image_bytes, content_type="image/jpeg" if content_type == "image/jpg" else content_type)
        set_default_rich_menu(rich_menu_id)
    except Exception as exc:
        # Best effort cleanup if creation succeeded but later steps failed.
        if rich_menu_id:
            try:
                delete_rich_menu(rich_menu_id)
            except Exception:
                pass
        return jsonify({"ok": False, "msg": f"LINE rich menu setup failed: {exc}"}), 500

    return jsonify(
        {
            "ok": True,
            "msg": "LINE Rich Menu created and set as default",
            "rich_menu_id": rich_menu_id,
            "menu": menu,
            "image_requirements": {"width": 2500, "height": 1686},
        }
    )


@line_bp.delete("/rich-menu/<string:rich_menu_id>")
@role_required("admin")
def remove_rich_menu(rich_menu_id: str):
    if not has_line_bot_config():
        return jsonify({"ok": False, "msg": "LINE Bot is not configured"}), 400
    try:
        delete_rich_menu(rich_menu_id)
    except Exception as exc:
        return jsonify({"ok": False, "msg": f"Delete rich menu failed: {exc}"}), 500
    return jsonify({"ok": True, "msg": "Rich menu deleted", "rich_menu_id": rich_menu_id})


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

            if etype == "postback":
                postback = event.get("postback") or {}
                _handle_postback(line_user_id, reply_token, postback.get("data"))
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
