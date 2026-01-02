"""Service utilities for 立翔水電行."""

from .notifications import (
    has_email_config,
    notify_task_assignment,
    notify_task_status_change,
    send_email_async,
)

__all__ = [
    "has_email_config",
    "notify_task_assignment",
    "notify_task_status_change",
    "send_email_async",
]
