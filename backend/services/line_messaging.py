from __future__ import annotations

import base64
import hashlib
import hmac
import os
from typing import Any, Optional, Sequence, Tuple

import requests

try:
    from flask import current_app
except Exception:
    current_app = None


LINE_API_BASE = "https://api.line.me/v2/bot/message"
LINE_DATA_API_BASE = "https://api-data.line.me/v2/bot/message"
LINE_RICHMENU_API_BASE = "https://api.line.me/v2/bot/richmenu"
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


def reply_messages(reply_token: str, messages: Sequence[dict[str, Any]], app=None) -> bool:
    """Reply with arbitrary LINE message payloads. Return True if 2xx."""
    if not has_line_bot_config(app=app) or not reply_token or not messages:
        return False

    url = f"{LINE_API_BASE}/reply"
    payload: dict[str, Any] = {
        "replyToken": reply_token,
        "messages": list(messages)[:5],
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


def push_messages(to_user_id: str, messages: Sequence[dict[str, Any]], app=None) -> bool:
    """Push arbitrary LINE messages to a LINE userId (starts with 'U')."""
    if not has_line_bot_config(app=app) or not to_user_id or not messages:
        return False

    url = f"{LINE_API_BASE}/push"
    payload: dict[str, Any] = {
        "to": to_user_id,
        "messages": list(messages)[:5],
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


def _safe_text(value: Any, *, max_len: int = 80) -> str:
    text = str(value or "").strip()
    if not text:
        return "-"
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def _fmt_task_dt(value: Any) -> str:
    if value is None:
        return "-"
    try:
        # datetime-like object
        if hasattr(value, "strftime"):
            return value.strftime("%Y-%m-%d %H:%M")
    except Exception:
        pass
    return _safe_text(value, max_len=24)


def _task_action_uri(task_id: Any, app=None) -> str | None:
    base = (_cfg("APP_BASE_URL", app=app) or "").strip().rstrip("/")
    if not base:
        return None
    return f"{base}/tasks/{task_id}"


def build_task_action_flex(task: Any, *, app=None) -> dict[str, Any]:
    """Build a LINE Flex card with quick actions for a task (Traditional Chinese UI)."""
    task_id = getattr(task, "id", None)
    title = _safe_text(getattr(task, "title", None), max_len=56)
    status = _safe_text(getattr(task, "status", None), max_len=20)
    location = _safe_text(getattr(task, "location", None), max_len=72)
    expected = _fmt_task_dt(getattr(task, "expected_time", None))
    due = _fmt_task_dt(getattr(task, "due_date", None))
    open_uri = _task_action_uri(task_id, app=app)
    location_uri = str(getattr(task, "location_url", "") or "").strip() or None

    def row(label: str, value: str, *, value_color: str = "#111827") -> dict[str, Any]:
        return {
            "type": "box",
            "layout": "baseline",
            "spacing": "sm",
            "contents": [
                {
                    "type": "text",
                    "text": label,
                    "size": "sm",
                    "color": "#6B7280",
                    "flex": 3,
                },
                {
                    "type": "text",
                    "text": value,
                    "size": "sm",
                    "color": value_color,
                    "wrap": True,
                    "align": "end",
                    "flex": 5,
                    "weight": "bold" if label in {"任務編號", "任務狀態"} else "regular",
                },
            ],
        }

    body_contents: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": "新任務",
            "size": "sm",
            "weight": "bold",
            "color": "#10B981",
        },
        {
            "type": "text",
            "text": title,
            "size": "xl",
            "weight": "bold",
            "wrap": True,
            "color": "#1F2937",
            "margin": "sm",
        },
        {
            "type": "text",
            "text": location,
            "size": "sm",
            "color": "#6B7280",
            "wrap": True,
            "margin": "xs",
        },
    ]

    if location_uri:
        body_contents.append(
            {
                "type": "text",
                "text": "查看地圖",
                "size": "xs",
                "color": "#16A34A",
                "align": "end",
                "margin": "xs",
                "action": {"type": "uri", "label": "查看地圖", "uri": location_uri},
            }
        )

    body_contents.extend(
        [
            {"type": "separator", "margin": "md"},
            {
                "type": "box",
                "layout": "vertical",
                "spacing": "sm",
                "margin": "md",
                "contents": [
                    row("預計開始", expected),
                    row("完成截止日", due),
                    row("任務編號", str(task_id or "-")),
                    row("任務狀態", status, value_color="#111827"),
                ],
            },
        ]
    )

    footer_contents: list[dict[str, Any]] = [
        {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "style": "secondary",
                    "height": "sm",
                    "color": "#D1D5DB",
                    "action": {
                        "type": "postback",
                        "label": "拒絕",
                        "data": f"a=reject_prompt&t={task_id}",
                        "displayText": f"無法接單 #{task_id}",
                    },
                },
                {
                    "type": "button",
                    "style": "primary",
                    "height": "sm",
                    "color": "#22C55E",
                    "action": {
                        "type": "postback",
                        "label": "接受",
                        "data": f"a=task_accept&t={task_id}",
                        "displayText": f"接受任務 #{task_id}",
                    },
                },
            ],
        },
        {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "style": "secondary",
                    "height": "sm",
                    "action": {
                        "type": "postback",
                        "label": "開始工時",
                        "data": f"a=time_start&t={task_id}",
                        "displayText": f"開始工時 #{task_id}",
                    },
                },
                {
                    "type": "button",
                    "style": "secondary",
                    "height": "sm",
                    "action": {
                        "type": "postback",
                        "label": "結束工時",
                        "data": f"a=time_stop&t={task_id}",
                        "displayText": f"結束工時 #{task_id}",
                    },
                },
            ],
        },
        {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "style": "link",
                    "height": "sm",
                    "action": {
                        "type": "postback",
                        "label": "開始施工",
                        "data": f"a=task_start&t={task_id}",
                        "displayText": f"start {task_id}",
                    },
                },
                {
                    "type": "button",
                    "style": "link",
                    "height": "sm",
                    "action": {"type": "message", "label": "本週工作", "text": "本週"},
                },
            ],
        },
    ]

    if open_uri:
        footer_contents.append(
            {
                "type": "button",
                "style": "link",
                "height": "sm",
                "action": {"type": "uri", "label": "開啟任務", "uri": open_uri},
            }
        )

    return {
        "type": "flex",
        "altText": _safe_text(f"新任務 #{task_id} {title}", max_len=100),
        "contents": {
            "type": "bubble",
            "size": "mega",
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "sm",
                "paddingAll": "16px",
                "contents": body_contents,
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "spacing": "sm",
                "paddingAll": "12px",
                "contents": footer_contents,
            },
        },
    }


def push_task_action_flex(to_user_id: str, task: Any, app=None) -> bool:
    """Push a task action card to LINE."""
    return push_messages(to_user_id, [build_task_action_flex(task, app=app)], app=app)


def _line_http(
    method: str,
    url: str,
    *,
    app=None,
    timeout: int = 20,
    **kwargs,
) -> requests.Response:
    headers = kwargs.pop("headers", None)
    if headers is None:
        headers = _headers(app=app)
    resp = requests.request(method, url, headers=headers, timeout=timeout, **kwargs)
    if resp.status_code >= 400:
        detail = ""
        try:
            detail = resp.text
        except Exception:
            detail = ""
        raise RuntimeError(f"LINE API failed: {resp.status_code} {detail}".strip())
    return resp


def build_default_rich_menu(
    *,
    app=None,
    chat_bar_text: str = "功能選單",
    base_url: str | None = None,
) -> dict[str, Any]:
    """Default rich menu layout (3x2) for task operations.

    Image requirement:
      - width: 2500
      - height: 1686
      - PNG or JPEG
    """
    width = 2500
    height = 1686
    col_widths = [833, 834, 833]
    row_heights = [843, 843]

    base = (base_url or _cfg("APP_BASE_URL", app=app) or "").strip().rstrip("/")
    has_base = bool(base)

    x_positions = [0, col_widths[0], col_widths[0] + col_widths[1]]
    y_positions = [0, row_heights[0]]

    def area(x: int, y: int, w: int, h: int, action: dict[str, Any]) -> dict[str, Any]:
        return {
            "bounds": {"x": x, "y": y, "width": w, "height": h},
            "action": action,
        }

    areas: list[dict[str, Any]] = [
        area(
            x_positions[0],
            y_positions[0],
            col_widths[0],
            row_heights[0],
            {"type": "message", "label": "任務列表", "text": "tasks"},
        ),
        area(
            x_positions[1],
            y_positions[0],
            col_widths[1],
            row_heights[0],
            {"type": "message", "label": "本週行程", "text": "本週"},
        ),
        area(
            x_positions[2],
            y_positions[0],
            col_widths[2],
            row_heights[0],
            {"type": "message", "label": "功能說明", "text": "help"},
        ),
        area(
            x_positions[0],
            y_positions[1],
            col_widths[0],
            row_heights[1],
            (
                {"type": "uri", "label": "任務頁面", "uri": f"{base}/app"}
                if has_base
                else {"type": "message", "label": "任務頁面", "text": "tasks"}
            ),
        ),
        area(
            x_positions[1],
            y_positions[1],
            col_widths[1],
            row_heights[1],
            (
                {"type": "uri", "label": "個人資料", "uri": f"{base}/profile"}
                if has_base
                else {"type": "message", "label": "個人資料", "text": "help"}
            ),
        ),
        area(
            x_positions[2],
            y_positions[1],
            col_widths[2],
            row_heights[1],
            (
                {"type": "uri", "label": "行事曆", "uri": f"{base}/calendar"}
                if has_base
                else {"type": "message", "label": "行事曆", "text": "calendar"}
            ),
        ),
    ]

    return {
        "size": {"width": width, "height": height},
        "selected": True,
        "name": "TaskGo Worker Menu",
        "chatBarText": str(chat_bar_text or "功能選單")[:14],
        "areas": areas,
    }


def list_rich_menus(*, app=None) -> dict[str, Any]:
    resp = _line_http("GET", "/".join([LINE_RICHMENU_API_BASE, "list"]), app=app)
    return resp.json() if resp.content else {}


def create_rich_menu(menu: dict[str, Any], *, app=None) -> str:
    resp = _line_http("POST", LINE_RICHMENU_API_BASE, app=app, json=menu)
    payload = resp.json() if resp.content else {}
    rich_menu_id = str(payload.get("richMenuId") or "").strip()
    if not rich_menu_id:
        raise RuntimeError("LINE API returned no richMenuId")
    return rich_menu_id


def upload_rich_menu_image(
    rich_menu_id: str,
    image_bytes: bytes,
    *,
    content_type: str = "image/png",
    app=None,
) -> bool:
    if not rich_menu_id:
        raise RuntimeError("rich_menu_id is required")
    if not image_bytes:
        raise RuntimeError("image content is empty")
    url = f"{LINE_RICHMENU_API_BASE}/{rich_menu_id}/content"
    headers = _headers(app=app, json_content=False)
    headers["Content-Type"] = content_type
    _line_http("POST", url, app=app, headers=headers, data=image_bytes, timeout=30)
    return True


def set_default_rich_menu(rich_menu_id: str, *, app=None) -> bool:
    if not rich_menu_id:
        raise RuntimeError("rich_menu_id is required")
    url = f"https://api.line.me/v2/bot/user/all/richmenu/{rich_menu_id}"
    _line_http("POST", url, app=app, json={})
    return True


def delete_rich_menu(rich_menu_id: str, *, app=None) -> bool:
    if not rich_menu_id:
        raise RuntimeError("rich_menu_id is required")
    _line_http("DELETE", f"{LINE_RICHMENU_API_BASE}/{rich_menu_id}", app=app)
    return True


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
