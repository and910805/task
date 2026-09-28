"""Service utilities for TaskGo."""

from .notifications import (
    has_email_config,
    notify_overdue_tasks,
    notify_task_assignment,
    notify_task_overdue,
    notify_task_status_change,
    send_email_async,
)

__all__ = [
    "has_email_config",
    "notify_overdue_tasks",
    "notify_task_assignment",
    "notify_task_overdue",
    "notify_task_status_change",
    "send_email_async",
]
