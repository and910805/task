from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from decorators import role_required
from extensions import db
from models import Task, TaskAssignee, TaskUpdate, User

dashboard_bp = Blueprint("dashboard", __name__)

STATUS_PENDING = "撠?亙"
STATUS_IN_PROGRESS = "撌脫??"
STATUS_WORKING = "?脰?銝?"
STATUS_DONE = "撌脣???"


def _task_due_time(task: Task):
    return task.due_date or task.expected_time


@dashboard_bp.get("/overview")
@jwt_required()
@role_required("site_supervisor", "hq_staff", "admin")
def overview():
    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)
    today_end = today_start + timedelta(days=1)
    due_expr = func.coalesce(Task.due_date, Task.expected_time)

    tasks_today = (
        Task.query.options(
            selectinload(Task.assignee),
            selectinload(Task.assignees).selectinload(TaskAssignee.user),
        )
        .filter(due_expr.isnot(None))
        .filter(due_expr >= today_start, due_expr < today_end)
        .order_by(due_expr.asc())
        .all()
    )

    status_counts = dict(
        db.session.query(Task.status, func.count(Task.id)).group_by(Task.status).all()
    )

    overdue_count = (
        Task.query.filter(Task.status != STATUS_DONE)
        .filter(Task.due_date.isnot(None))
        .filter(Task.due_date < now)
        .count()
    )

    assignee_counter: dict[int, dict] = {}
    for task in tasks_today:
        assignees = []
        if task.assignee:
            assignees.append(task.assignee)
        for assignment in task.assignees:
            if assignment.user:
                assignees.append(assignment.user)
        unique = {user.id: user for user in assignees if user and user.id}
        if not unique:
            continue
        for user in unique.values():
            entry = assignee_counter.setdefault(
                user.id,
                {"user_id": user.id, "username": user.username, "count": 0},
            )
            entry["count"] += 1

    today_payload = []
    for task in tasks_today:
        due_time = _task_due_time(task)
        assignees = []
        if task.assignee:
            assignees.append({"id": task.assignee.id, "username": task.assignee.username})
        for assignment in task.assignees:
            if assignment.user:
                assignees.append(
                    {"id": assignment.user.id, "username": assignment.user.username}
                )
        if assignees:
            seen = set()
            deduped = []
            for item in assignees:
                if item["id"] in seen:
                    continue
                seen.add(item["id"])
                deduped.append(item)
            assignees = deduped

        today_payload.append(
            {
                "id": task.id,
                "title": task.title,
                "status": task.status,
                "location": task.location,
                "due_time": due_time.isoformat() if due_time else None,
                "assignees": assignees,
            }
        )

    return jsonify(
        {
            "date": today_start.date().isoformat(),
            "counts": {
                "total": sum(status_counts.values()),
                "pending": status_counts.get(STATUS_PENDING, 0),
                "in_progress": status_counts.get(STATUS_IN_PROGRESS, 0),
                "working": status_counts.get(STATUS_WORKING, 0),
                "done": status_counts.get(STATUS_DONE, 0),
                "overdue": overdue_count,
            },
            "today_tasks": today_payload,
            "today_by_assignee": sorted(
                assignee_counter.values(), key=lambda item: item["count"], reverse=True
            ),
        }
    )


@dashboard_bp.get("/worker-stats")
@jwt_required()
@role_required("site_supervisor", "hq_staff", "admin")
def worker_stats():
    try:
        days = int(request.args.get("days", "7"))
    except ValueError:
        days = 7
    days = max(1, min(days, 90))
    now = datetime.utcnow()
    since = now - timedelta(days=days)

    work_rows = (
        db.session.query(TaskUpdate.user_id, func.coalesce(func.sum(TaskUpdate.work_hours), 0))
        .filter(TaskUpdate.created_at >= since)
        .group_by(TaskUpdate.user_id)
        .all()
    )
    work_map = {row[0]: float(row[1] or 0) for row in work_rows if row[0]}

    completed_rows = (
        db.session.query(Task.assigned_to_id, func.count(Task.id))
        .filter(Task.status == STATUS_DONE)
        .filter(Task.completed_at.isnot(None))
        .filter(Task.completed_at >= since)
        .group_by(Task.assigned_to_id)
        .all()
    )
    completed_map = {row[0]: int(row[1] or 0) for row in completed_rows if row[0]}

    users = (
        User.query.filter(User.role != "admin")
        .order_by(User.username.asc())
        .all()
    )

    items = []
    for user in users:
        items.append(
            {
                "user_id": user.id,
                "username": user.username,
                "role": user.role,
                "completed_count": completed_map.get(user.id, 0),
                "total_hours": round(work_map.get(user.id, 0.0), 2),
            }
        )

    items.sort(key=lambda item: (-item["completed_count"], -item["total_hours"]))

    return jsonify(
        {
            "days": days,
            "since": since.date().isoformat(),
            "items": items,
        }
    )
