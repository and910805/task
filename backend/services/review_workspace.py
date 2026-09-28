"""Demo company for App Store review (guideline 2.1: demo account for login apps)."""

from __future__ import annotations

from datetime import datetime, timedelta

from extensions import db
from models import Task, TaskAssignee, TaskUpdate, User, Workspace, WorkspaceMember
from routes.workspaces import create_workspace_for

DEMO_TASKS = (
    ("浴室水龍頭漏水維修", "台北市大安區示範路 1 號", 1, "尚未接單"),
    ("客廳插座更換", "台北市信義區示範街 20 號 5F", 4, "已接單"),
    ("熱水器定期保養", "新北市板橋區示範巷 8 號", 26, "尚未接單"),
    ("陽台排水疏通", "台北市中山區示範大道 99 號", -30, "已完成"),
)


def create_review_workspace(*, name: str, owner_username: str, worker_username: str, password: str) -> dict:
    if len(password) < 10:
        raise ValueError("password must be at least 10 characters")
    if User.query.filter(User.username.in_([owner_username, worker_username])).first():
        raise ValueError("review accounts already exist; delete them first or pick other usernames")

    owner = User(username=owner_username, role="worker")
    owner.set_password(password)
    worker = User(username=worker_username, role="worker")
    worker.set_password(password)
    db.session.add_all([owner, worker])
    db.session.flush()

    workspace: Workspace = create_workspace_for(owner, name, "plumbing_electrical")
    db.session.add(WorkspaceMember(workspace_id=workspace.id, user_id=worker.id, role="worker"))
    db.session.flush()

    now = datetime.utcnow()
    for title, location, offset_hours, status in DEMO_TASKS:
        task = Task(
            workspace_id=workspace.id,
            title=title,
            description=f"{title}（App 審核示範資料）",
            location=location,
            expected_time=now + timedelta(hours=offset_hours),
            status=status,
            assigned_to_id=worker.id,
            assigned_by_id=owner.id,
            completed_at=now - timedelta(hours=28) if status == "已完成" else None,
        )
        db.session.add(task)
        db.session.flush()
        db.session.add(TaskAssignee(task_id=task.id, user_id=worker.id))
        if status == "已完成":
            db.session.add(TaskUpdate(task_id=task.id, user_id=worker.id, status="已完成", note="已疏通並測試排水正常。"))
    db.session.commit()
    return {"workspace_id": workspace.id, "tasks": len(DEMO_TASKS)}
