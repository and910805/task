from datetime import datetime
from typing import Optional

from flask import current_app
from werkzeug.security import check_password_hash, generate_password_hash

from sqlalchemy import UniqueConstraint

from extensions import db


ROLE_LABEL_DEFAULTS = {
    "worker": "工人",
    "site_supervisor": "現場主管",
    "hq_staff": "總部人員",
    "admin": "管理員",
}


class User(db.Model):
    __tablename__ = "user"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(32), nullable=False, default="worker")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    primary_assigned_tasks = db.relationship(
        "Task", back_populates="assignee", foreign_keys="Task.assigned_to_id"
    )
    assignments = db.relationship(
        "TaskAssignee", back_populates="user", cascade="all, delete-orphan"
    )
    assigned_tasks = db.relationship(
        "Task",
        secondary="task_assignee",
        viewonly=True,
        back_populates="assigned_users",
        overlaps="primary_assigned_tasks,assignee,assignments",
    )
    created_tasks = db.relationship(
        "Task", back_populates="assigner", foreign_keys="Task.assigned_by_id"
    )
    attachments = db.relationship("Attachment", back_populates="uploader")
    updates = db.relationship("TaskUpdate", back_populates="author")
    notification_type = db.Column(db.String(16))
    notification_value = db.Column(db.Text)

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def to_dict(self) -> dict:
        try:
            role_label = RoleLabel.get_labels().get(self.role, self.role)
        except Exception:
            role_label = ROLE_LABEL_DEFAULTS.get(self.role, self.role)

        notification_value = None
        notification_hint = None
        if self.notification_type == "email":
            notification_value = self.notification_value or None
        elif self.notification_type == "line" and self.notification_value:
            masked = self.notification_value
            if len(masked) > 4:
                masked = f"…{masked[-4:]}"
            notification_hint = masked

        return {
            "id": self.id,
            "username": self.username,
            "role": self.role,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "role_label": role_label,
            "notification_type": self.notification_type,
            "notification_value": notification_value,
            "notification_hint": notification_hint,
        }


class Task(db.Model):
    __tablename__ = "task"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(32), nullable=False, default="尚未接單")
    location = db.Column(db.String(255), nullable=False)
    expected_time = db.Column(db.DateTime, nullable=False)
    completed_at = db.Column(db.DateTime)
    assigned_to_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    assigned_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    due_date = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    assignee = db.relationship(
        "User",
        foreign_keys=[assigned_to_id],
        back_populates="primary_assigned_tasks",
        overlaps="assigned_tasks,assignments",
    )
    assigner = db.relationship("User", foreign_keys=[assigned_by_id], back_populates="created_tasks")
    attachments = db.relationship("Attachment", back_populates="task", cascade="all, delete-orphan")
    updates = db.relationship(
        "TaskUpdate",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskUpdate.created_at.desc()",
    )
    assignees = db.relationship(
        "TaskAssignee",
        back_populates="task",
        cascade="all, delete-orphan",
        overlaps="assigned_users,assignee",
    )
    assigned_users = db.relationship(
        "User",
        secondary="task_assignee",
        viewonly=True,
        back_populates="assigned_tasks",
        overlaps="assignee,assignees,assignments,primary_assigned_tasks",
    )

    def total_work_hours(self) -> float:
        return sum(
            (update.work_hours or 0.0)
            for update in self.updates
            if update.work_hours is not None
        )

    def is_overdue(self, now: datetime | None = None) -> bool:
        if not self.due_date:
            return False
        if self.status == "已完成":
            return False
        reference = now or datetime.utcnow()
        return self.due_date < reference

    def to_dict(self) -> dict:
        time_entries = [
            update.to_time_dict() for update in self.updates if update.start_time
        ]
        try:
            role_labels = RoleLabel.get_labels()
        except Exception:
            role_labels = ROLE_LABEL_DEFAULTS

        assigned_users = []
        for assignment in self.assignees:
            user = assignment.user
            if not user:
                continue
            assigned_users.append(
                {
                    "id": user.id,
                    "username": user.username,
                    "role": user.role,
                    "role_label": role_labels.get(user.role, user.role),
                }
            )
        if assigned_users:
            assigned_users.sort(key=lambda item: item["username"].lower())
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "status": self.status,
            "location": self.location,
            "expected_time": self.expected_time.isoformat() if self.expected_time else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "assigned_to": self.assignee.username if self.assignee else None,
            "assigned_to_id": self.assigned_to_id,
            "assigned_by": self.assigner.username if self.assigner else None,
            "assigned_by_id": self.assigned_by_id,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "attachments": [attachment.to_dict() for attachment in self.attachments],
            "updates": [update.to_dict() for update in self.updates],
            "time_entries": time_entries,
            "total_work_hours": round(self.total_work_hours(), 2),
            "is_overdue": self.is_overdue(),
            "assignees": assigned_users,
            "assignee_ids": [user["id"] for user in assigned_users],
        }


class TaskAssignee(db.Model):
    __tablename__ = "task_assignee"

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(
        db.Integer, db.ForeignKey("task.id", ondelete="CASCADE"), nullable=False
    )
    user_id = db.Column(
        db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    task = db.relationship(
        "Task", back_populates="assignees", overlaps="assigned_users,assignee"
    )
    user = db.relationship(
        "User", back_populates="assignments", overlaps="assigned_tasks"
    )

    __table_args__ = (UniqueConstraint("task_id", "user_id", name="uq_task_assignee"),)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "user_id": self.user_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class TaskUpdate(db.Model):
    __tablename__ = "task_update"

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("task.id"), nullable=False)
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    status = db.Column(db.String(32))
    note = db.Column(db.Text)
    start_time = db.Column(db.DateTime)
    end_time = db.Column(db.DateTime)
    work_hours = db.Column(db.Float)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    task = db.relationship("Task", back_populates="updates")
    author = db.relationship("User", back_populates="updates")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "note": self.note,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "author": self.author.username if self.author else None,
            "user_id": self.user_id,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "work_hours": self.work_hours,
        }

    def to_time_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "work_hours": self.work_hours,
            "author": self.author.username if self.author else None,
        }


class Attachment(db.Model):
    __tablename__ = "attachment"

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("task.id"), nullable=False)
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    file_type = db.Column(db.String(32))
    original_name = db.Column(db.String(255))
    file_path = db.Column(db.String(255), nullable=False)
    transcript = db.Column(db.Text)
    note = db.Column(db.Text)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)

    task = db.relationship("Task", back_populates="attachments")
    uploader = db.relationship("User", back_populates="attachments")

    def to_dict(self) -> dict:
        url = None
        try:
            storage = current_app.extensions.get("storage")  # type: ignore[attr-defined]
        except RuntimeError:
            storage = None
        if storage:
            try:
                if getattr(storage, "use_s3", False):
                    url = storage.url_for(self.file_path, expires_in=3600)
                else:
                    url = storage.url_for(self.file_path)
            except Exception:  # pragma: no cover - defensive fallback
                url = None
        if not url:
            url = f"/api/upload/files/{self.file_path}"
        return {
            "id": self.id,
            "file_type": self.file_type,
            "original_name": self.original_name,
            "note": self.note,
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None,
            "url": url,
            "transcript": self.transcript,
            "uploaded_by": self.uploader.username if self.uploader else None,
            "uploaded_by_id": self.uploaded_by_id,
        }


class RoleLabel(db.Model):
    __tablename__ = "role_label"

    id = db.Column(db.Integer, primary_key=True)
    role = db.Column(db.String(32), unique=True, nullable=False)
    label = db.Column(db.String(80), nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @staticmethod
    def _cache_store():
        try:
            return current_app.extensions.setdefault("role_labels_cache", {})
        except RuntimeError:
            return None

    @classmethod
    def get_overrides(cls) -> dict:
        cache = cls._cache_store()
        overrides = cache.get("overrides") if cache else None
        if overrides is not None:
            return overrides
        try:
            records = cls.query.all()
            overrides = {item.role: item.label for item in records}
        except Exception:
            overrides = {}
        if cache is not None:
            cache["overrides"] = overrides
        return overrides

    @classmethod
    def get_labels(cls) -> dict:
        cache = cls._cache_store()
        combined = cache.get("combined") if cache else None
        if combined is not None:
            return combined
        overrides = cls.get_overrides()
        combined = {**ROLE_LABEL_DEFAULTS, **overrides}
        if cache is not None:
            cache["combined"] = combined
        return combined

    @classmethod
    def clear_cache(cls) -> None:
        cache = cls._cache_store()
        if cache is not None:
            cache.pop("combined", None)
            cache.pop("overrides", None)

    def to_dict(self) -> dict:
        return {
            "role": self.role,
            "label": self.label,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class SiteSetting(db.Model):
    __tablename__ = "site_setting"

    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.Text, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @classmethod
    def get_record(cls, key: str) -> Optional["SiteSetting"]:
        try:
            return cls.query.filter_by(key=key).first()
        except Exception:
            return None

    @classmethod
    def get_value(cls, key: str, default: Optional[str] = None) -> Optional[str]:
        record = cls.get_record(key)
        if record is None:
            return default
        return record.value

    @classmethod
    def set_value(cls, key: str, value: str) -> "SiteSetting":
        record = cls.get_record(key)
        if record is None:
            record = cls(key=key, value=value)
            db.session.add(record)
        else:
            record.value = value
        db.session.commit()
        return record

    @classmethod
    def delete_value(cls, key: str) -> bool:
        record = cls.get_record(key)
        if record is None:
            return False
        db.session.delete(record)
        db.session.commit()
        return True
