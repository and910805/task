from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

from extensions import db


class User(db.Model):
    __tablename__ = "user"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(32), nullable=False, default="worker")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    assigned_tasks = db.relationship(
        "Task", back_populates="assignee", foreign_keys="Task.assigned_to_id"
    )
    created_tasks = db.relationship(
        "Task", back_populates="assigner", foreign_keys="Task.assigned_by_id"
    )
    attachments = db.relationship("Attachment", back_populates="uploader")
    updates = db.relationship("TaskUpdate", back_populates="author")

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "role": self.role,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Task(db.Model):
    __tablename__ = "task"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(32), nullable=False, default="pending")
    assigned_to_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    assigned_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    due_date = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    assignee = db.relationship("User", foreign_keys=[assigned_to_id], back_populates="assigned_tasks")
    assigner = db.relationship("User", foreign_keys=[assigned_by_id], back_populates="created_tasks")
    attachments = db.relationship("Attachment", back_populates="task", cascade="all, delete-orphan")
    updates = db.relationship(
        "TaskUpdate",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskUpdate.created_at.desc()",
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "status": self.status,
            "assigned_to": self.assignee.username if self.assignee else None,
            "assigned_to_id": self.assigned_to_id,
            "assigned_by": self.assigner.username if self.assigner else None,
            "assigned_by_id": self.assigned_by_id,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "attachments": [attachment.to_dict() for attachment in self.attachments],
            "updates": [update.to_dict() for update in self.updates],
        }


class TaskUpdate(db.Model):
    __tablename__ = "task_update"

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("task.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    status = db.Column(db.String(32))
    note = db.Column(db.Text)
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
        }


class Attachment(db.Model):
    __tablename__ = "attachment"

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("task.id"), nullable=False)
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    file_type = db.Column(db.String(32))
    original_name = db.Column(db.String(255))
    file_path = db.Column(db.String(255), nullable=False)
    note = db.Column(db.Text)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)

    task = db.relationship("Task", back_populates="attachments")
    uploader = db.relationship("User", back_populates="attachments")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "file_type": self.file_type,
            "original_name": self.original_name,
            "note": self.note,
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None,
            "url": f"/api/tasks/attachments/{self.file_path}",
        }
