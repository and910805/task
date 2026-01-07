from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from models import Task, TaskAssignee, User
from services.notifications import notify_task_due_digest


def _should_send_today(user: User, now: datetime) -> bool:
    frequency = (user.reminder_frequency or "daily").strip().lower()
    if frequency in {"off", "none"}:
        return False
    if frequency == "weekly":
        weekday = int(os.getenv("TASK_REMINDER_WEEKDAY", "0"))
        return now.weekday() == weekday
    return True


def _collect_recipients(task: Task) -> list[User]:
    recipients: list[User] = []
    seen: set[int] = set()
    if task.assignee and task.assignee.id not in seen:
        recipients.append(task.assignee)
        seen.add(task.assignee.id)
    for assignment in task.assignees:
        user = assignment.user
        if user and user.id not in seen:
            recipients.append(user)
            seen.add(user.id)
    return recipients


def run_due_task_reminders(now: datetime | None = None) -> int:
    reference = now or datetime.utcnow()
    window_hours = int(os.getenv("TASK_REMINDER_UPCOMING_HOURS", "24"))
    upcoming_until = reference + timedelta(hours=window_hours)

    tasks = (
        Task.query.options(
            joinedload(Task.assignee),
            joinedload(Task.assignees).joinedload(TaskAssignee.user),
        )
        .filter(Task.status != "已完成")
        .filter(or_(Task.due_date.isnot(None), Task.expected_time.isnot(None)))
        .all()
    )

    per_user: dict[int, dict[str, list[Task]]] = defaultdict(lambda: {"upcoming": [], "overdue": []})

    for task in tasks:
        due_at = task.due_date or task.expected_time
        if not due_at:
            continue
        if due_at <= reference:
            bucket = "overdue"
        elif due_at <= upcoming_until:
            bucket = "upcoming"
        else:
            continue

        for user in _collect_recipients(task):
            per_user[user.id][bucket].append(task)

    notified = 0
    for user_id, buckets in per_user.items():
        user = User.query.get(user_id)
        if not user:
            continue
        if not user.notification_type or not user.notification_value:
            continue
        if not _should_send_today(user, reference):
            continue
        if notify_task_due_digest(
            user,
            upcoming=buckets["upcoming"],
            overdue=buckets["overdue"],
        ):
            notified += 1

    return notified
