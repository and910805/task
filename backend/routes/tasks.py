import os
import uuid
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from sqlalchemy import or_

from decorators import role_required
from extensions import db
from models import Attachment, Task, TaskUpdate, User


tasks_bp = Blueprint("tasks", __name__)

ALLOWED_STATUSES = {"pending", "in_progress", "completed", "on_hold"}
ALLOWED_ATTACHMENT_TYPES = {"image", "audio", "signature", "other"}


@tasks_bp.get("/")
@jwt_required()
def list_tasks():
    user_id = get_jwt_identity()
    role = (get_jwt() or {}).get("role")

    query = Task.query
    if role == "worker":
        query = query.filter(Task.assigned_to_id == user_id)
    elif role == "site_supervisor":
        query = query.filter(
            or_(Task.assigned_by_id == user_id, Task.assigned_to_id == user_id)
        )

    tasks = query.order_by(Task.created_at.desc()).all()
    return jsonify([task.to_dict() for task in tasks])


@tasks_bp.post("/")
@role_required("site_supervisor", "hq_staff")
def create_task():
    data = request.get_json() or {}
    title = (data.get("title") or "").strip()
    description = data.get("description")
    assigned_to_id = data.get("assigned_to_id")
    due_date_raw = data.get("due_date")

    if not title:
        return jsonify({"msg": "Title is required"}), 400

    if assigned_to_id:
        assignee = User.query.get_or_404(assigned_to_id)
        if assignee.role == "admin":
            return jsonify({"msg": "Cannot assign tasks to admin users"}), 400

    due_date = None
    if due_date_raw:
        try:
            due_date = datetime.fromisoformat(due_date_raw)
        except ValueError:
            return jsonify({"msg": "Invalid due date format"}), 400

    task = Task(
        title=title,
        description=description,
        assigned_to_id=assigned_to_id,
        assigned_by_id=get_jwt_identity(),
        due_date=due_date,
    )
    db.session.add(task)
    db.session.commit()

    return jsonify(task.to_dict()), 201


@tasks_bp.get("/<int:task_id>")
@jwt_required()
def get_task(task_id: int):
    task = Task.query.get_or_404(task_id)
    role = (get_jwt() or {}).get("role")
    user_id = get_jwt_identity()

    if role == "worker" and task.assigned_to_id != user_id:
        return jsonify({"msg": "You do not have access to this task"}), 403

    return jsonify(task.to_dict())


@tasks_bp.put("/<int:task_id>")
@role_required("site_supervisor", "hq_staff")
def update_task(task_id: int):
    task = Task.query.get_or_404(task_id)
    data = request.get_json() or {}

    title = data.get("title")
    description = data.get("description")
    status = data.get("status")
    assigned_to_id = data.get("assigned_to_id")
    due_date_raw = data.get("due_date")

    if title:
        task.title = title
    if description is not None:
        task.description = description
    if status:
        if status not in ALLOWED_STATUSES:
            return jsonify({"msg": "Invalid status"}), 400
        task.status = status
    if assigned_to_id is not None:
        if assigned_to_id:
            assignee = User.query.get_or_404(assigned_to_id)
            if assignee.role == "admin":
                return jsonify({"msg": "Cannot assign tasks to admin users"}), 400
        task.assigned_to_id = assigned_to_id
    if due_date_raw is not None:
        if due_date_raw == "":
            task.due_date = None
        else:
            try:
                task.due_date = datetime.fromisoformat(due_date_raw)
            except ValueError:
                return jsonify({"msg": "Invalid due date format"}), 400

    db.session.commit()
    return jsonify(task.to_dict())


@tasks_bp.post("/<int:task_id>/updates")
@jwt_required()
def add_update(task_id: int):
    task = Task.query.get_or_404(task_id)
    data = request.get_json() or {}
    status = data.get("status")
    note = data.get("note")

    user_id = get_jwt_identity()
    role = (get_jwt() or {}).get("role")

    if role == "worker" and task.assigned_to_id != user_id:
        return jsonify({"msg": "You cannot update this task"}), 403

    if not status and not note:
        return jsonify({"msg": "Status or note is required"}), 400

    if status and status not in ALLOWED_STATUSES:
        return jsonify({"msg": "Invalid status"}), 400

    update = TaskUpdate(task_id=task.id, user_id=user_id, status=status, note=note)
    task.updated_at = datetime.utcnow()
    if status:
        task.status = status
    db.session.add(update)
    db.session.commit()

    return jsonify(update.to_dict()), 201


@tasks_bp.post("/<int:task_id>/attachments")
@jwt_required()
def upload_attachment(task_id: int):
    task = Task.query.get_or_404(task_id)
    role = (get_jwt() or {}).get("role")
    user_id = get_jwt_identity()

    if role == "worker" and task.assigned_to_id != user_id:
        return jsonify({"msg": "You cannot upload for this task"}), 403

    if "file" not in request.files:
        return jsonify({"msg": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"msg": "File name is required"}), 400

    uploads_dir = current_app.config["UPLOAD_FOLDER"]
    _, ext = os.path.splitext(file.filename)
    safe_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(uploads_dir, safe_name)
    file.save(file_path)

    file_type = request.form.get("file_type", "other")
    if file_type not in ALLOWED_ATTACHMENT_TYPES:
        file_type = "other"
    note = request.form.get("note")

    attachment = Attachment(
        task_id=task.id,
        uploaded_by_id=user_id,
        file_type=file_type,
        original_name=file.filename,
        file_path=safe_name,
        note=note,
    )
    db.session.add(attachment)
    db.session.commit()

    return jsonify(attachment.to_dict()), 201


@tasks_bp.get("/attachments/<path:filename>")
@jwt_required()
def get_attachment(filename: str):
    uploads_dir = current_app.config["UPLOAD_FOLDER"]
    return send_from_directory(uploads_dir, filename)
