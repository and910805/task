from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required
from app import db
from app.models import Task, Attachment
import os

task_bp = Blueprint("tasks", __name__)


@task_bp.route("/", methods=["GET"])
@jwt_required()
def list_tasks():
    tasks = Task.query.order_by(Task.id.desc()).all()
    return jsonify(
        [
            {
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "description": t.description,
                "assigned_to_id": t.assigned_to_id,
                "assigned_by_id": t.assigned_by_id,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
            }
            for t in tasks
        ]
    )


@task_bp.route("/", methods=["POST"])
@jwt_required()
def create_task():
    data = request.json or {}
    title = data.get("title")

    if not title:
        return jsonify({"msg": "Title is required"}), 400

    task = Task(
        title=title,
        description=data.get("description"),
        assigned_to_id=data.get("assigned_to_id"),
        assigned_by_id=data.get("assigned_by_id"),
    )
    db.session.add(task)
    db.session.commit()
    return jsonify({"msg": "Task created", "id": task.id})


@task_bp.route("/<int:task_id>/upload", methods=["POST"])
@jwt_required()
def upload_file(task_id):
    if "file" not in request.files:
        return jsonify({"msg": "File is required"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"msg": "Filename is required"}), 400

    filename = file.filename
    path = os.path.join(current_app.config["UPLOAD_FOLDER"], filename)
    file.save(path)

    att = Attachment(task_id=task_id, file_path=filename)
    db.session.add(att)
    db.session.commit()
    return jsonify({"msg": "File uploaded"})
