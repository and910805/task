import os
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, redirect, request, send_file
from flask_jwt_extended import get_jwt, jwt_required
from sqlalchemy import or_
from sqlalchemy.orm import selectinload

from decorators import role_required
from extensions import db
from models import Task, TaskAssignee, TaskUpdate, User
from services.attachments import (
    create_file_attachment,
    create_signature_attachment,
)
from services import notify_task_assignment, notify_task_status_change
from storage import StorageError
from utils import get_current_user_id


tasks_bp = Blueprint("tasks", __name__)

TASK_STATUS_OPTIONS = ["尚未接單", "進行中", "已完成"]
ALLOWED_STATUSES = set(TASK_STATUS_OPTIONS)
ALLOWED_ATTACHMENT_TYPES = {"image", "audio", "signature", "other"}


def _task_assigned_user_ids(task: Task) -> set[int]:
    ids: set[int] = set()
    if task.assigned_to_id:
        ids.add(task.assigned_to_id)
    for assignment in task.assignees:
        if assignment.user_id:
            ids.add(assignment.user_id)
    return ids


def _ensure_task_permission(task: Task, role: str | None, user_id: int | None, *, message: str = "You do not have access to this task"):
    if user_id is None:
        return jsonify({"msg": "Invalid authentication token"}), 401
    if role == "worker" and user_id not in _task_assigned_user_ids(task):
        return jsonify({"msg": message}), 403
    return None


def _parse_datetime(value, field_name: str, *, required: bool = False):
    if value is None:
        if required:
            return None, jsonify({"msg": f"{field_name} is required"}), 400
        return None, None, None

    if isinstance(value, str):
        value = value.strip()
    if value == "":
        if required:
            return None, jsonify({"msg": f"{field_name} is required"}), 400
        return None, None, None

    parsed = None

    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        candidate = value
        if candidate.endswith("Z"):
            candidate = candidate[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            # Accept strings without the "T" separator as a last resort.
            alternate = candidate.replace("T", " ", 1)
            try:
                parsed = datetime.fromisoformat(alternate)
            except ValueError:
                parsed = None

    if parsed is None:
        return None, jsonify({"msg": f"Invalid {field_name} format"}), 400

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)

    return parsed, None, None


def _apply_task_status(task: Task, new_status: str) -> tuple[bool, tuple | None]:
    if not new_status:
        return False, None
    if new_status not in ALLOWED_STATUSES:
        return False, (jsonify({"msg": "Invalid status"}), 400)

    if task.status != new_status:
        previous = task.status
        task.status = new_status
        if new_status == "已完成" and previous != "已完成":
            task.completed_at = datetime.utcnow()
        elif new_status != "已完成":
            task.completed_at = None
        return True, None

    return False, None


def _validate_required_field(value, field_name: str):
    if value is None:
        return jsonify({"msg": f"{field_name} is required"}), 400
    if isinstance(value, str):
        value = value.strip()
    if value == "":
        return jsonify({"msg": f"{field_name} is required"}), 400
    return None


def _normalize_user_id(value):
    if value in (None, "", 0, "0"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _dedupe_ids(values):
    seen: set[int] = set()
    ordered: list[int] = []
    for value in values:
        if value is None:
            continue
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _get_assignee_ids_for_create(data: dict) -> list[int]:
    raw_ids = data.get("assignee_ids")
    candidate_ids: list[int] = []
    if isinstance(raw_ids, (list, tuple, set)):
        candidate_ids.extend(_normalize_user_id(item) for item in raw_ids)
    elif raw_ids not in (None, ""):
        candidate_ids.append(_normalize_user_id(raw_ids))

    single = _normalize_user_id(data.get("assigned_to_id"))
    if single is not None:
        candidate_ids.append(single)

    return _dedupe_ids(candidate_ids)


def _get_assignee_ids_for_update(data: dict) -> tuple[list[int], bool]:
    if "assignee_ids" in data:
        raw_ids = data.get("assignee_ids")
        candidate_ids: list[int] = []
        if isinstance(raw_ids, (list, tuple, set)):
            candidate_ids.extend(_normalize_user_id(item) for item in raw_ids)
        elif raw_ids not in (None, ""):
            candidate_ids.append(_normalize_user_id(raw_ids))
        return _dedupe_ids(candidate_ids), True

    if "assigned_to_id" in data:
        single = _normalize_user_id(data.get("assigned_to_id"))
        return ([single] if single else []), True

    return [], False


def _load_assignee_users(assignee_ids: list[int]):
    if not assignee_ids:
        return {}, None

    users = User.query.filter(User.id.in_(assignee_ids)).all()
    user_map = {user.id: user for user in users}
    missing = [user_id for user_id in assignee_ids if user_id not in user_map]
    if missing:
        return {}, (jsonify({"msg": f"User {missing[0]} not found"}), 404)

    for user in users:
        if user.role == "admin":
            return {}, (jsonify({"msg": "Cannot assign tasks to admin users"}), 400)

    return user_map, None


def _sync_task_assignees(task: Task, assignee_ids: list[int]):
    desired = _dedupe_ids(assignee_ids)
    existing = {assignment.user_id: assignment for assignment in task.assignees}
    added: list[int] = []
    removed: list[int] = []

    for assignment in list(task.assignees):
        if assignment.user_id not in desired:
            removed.append(assignment.user_id)
            db.session.delete(assignment)

    for user_id in desired:
        if user_id not in existing:
            task.assignees.append(TaskAssignee(user_id=user_id))
            added.append(user_id)

    task.assigned_to_id = desired[0] if desired else None
    return added, removed


def _task_notification_recipients(task: Task):
    recipients = []
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


def _notify_task_changes(task: Task, summary: dict, actor_id: int | None):
    actor = User.query.get(actor_id) if actor_id else None
    assignee_map = summary.get("assignee_map") or {}
    added_users = [
        assignee_map.get(user_id)
        for user_id in summary.get("assignee_added", [])
        if assignee_map.get(user_id)
    ]
    if added_users:
        notify_task_assignment(task, added_users, assigned_by=actor)

    if summary.get("status_changed"):
        recipients = _task_notification_recipients(task)
        notify_task_status_change(task, recipients, updated_by=actor)


def _serialize_task_for_viewer(task: Task, role: str | None, user_id: int | None) -> dict:
    data = task.to_dict()
    if role == "worker":
        attachments = data.get("attachments") or []
        if user_id is None:
            data["attachments"] = []
        else:
            data["attachments"] = [
                attachment
                for attachment in attachments
                if attachment.get("uploaded_by_id") == user_id
            ]
    return data


@tasks_bp.get("/")
@jwt_required()
def list_tasks():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"msg": "Invalid authentication token"}), 401
    role = (get_jwt() or {}).get("role")

    query = Task.query.options(
        selectinload(Task.attachments),
        selectinload(Task.updates),
        selectinload(Task.assignees).selectinload(TaskAssignee.user),
        selectinload(Task.assigner),
        selectinload(Task.assignee),
    ).outerjoin(TaskAssignee, TaskAssignee.task_id == Task.id)

    if role == "worker":
        query = query.filter(
            or_(TaskAssignee.user_id == user_id, Task.assigned_to_id == user_id)
        )
    elif role == "site_supervisor":
        query = query.filter(
            or_(
                Task.assigned_by_id == user_id,
                TaskAssignee.user_id == user_id,
                Task.assigned_to_id == user_id,
            )
        )

    tasks = (
        query.distinct()
        .order_by(Task.created_at.desc())
        .all()
    )
    payload = [_serialize_task_for_viewer(task, role, user_id) for task in tasks]
    return jsonify(payload)


def _handle_create_task(data, creator_id):
    title = (data.get("title") or "").strip()
    description_raw = data.get("description")
    location_raw = data.get("location")
    expected_time_raw = data.get("expected_time")
    status_raw = (data.get("status") or "尚未接單").strip()
    due_date_raw = data.get("due_date")

    if not title:
        return jsonify({"msg": "Title is required"}), 400

    description_error = _validate_required_field(description_raw, "Description")
    if description_error:
        return description_error
    description = description_raw.strip() if isinstance(description_raw, str) else description_raw

    location_error = _validate_required_field(location_raw, "Location")
    if location_error:
        return location_error
    location = location_raw.strip() if isinstance(location_raw, str) else location_raw

    expected_time, error_response, status_code = _parse_datetime(
        expected_time_raw, "Expected time", required=True
    )
    if error_response:
        return error_response, status_code

    if status_raw not in ALLOWED_STATUSES:
        return jsonify({"msg": "Invalid status"}), 400

    assignee_ids = _get_assignee_ids_for_create(data)
    assignee_map, error = _load_assignee_users(assignee_ids)
    if error:
        return error

    due_date = None
    if due_date_raw is not None and due_date_raw != "":
        due_date, error_response, status_code = _parse_datetime(due_date_raw, "Due date")
        if error_response:
            return error_response, status_code

    task = Task(
        title=title,
        description=description,
        status=status_raw,
        location=location,
        expected_time=expected_time,
        assigned_to_id=assignee_ids[0] if assignee_ids else None,
        assigned_by_id=creator_id,
        due_date=due_date,
    )

    if task.status == "已完成":
        task.completed_at = datetime.utcnow()

    db.session.add(task)
    db.session.flush()
    added_ids, _ = _sync_task_assignees(task, assignee_ids)
    db.session.commit()

    creator = User.query.get(creator_id)
    new_users = [assignee_map[user_id] for user_id in added_ids if user_id in assignee_map]
    if new_users:
        notify_task_assignment(task, new_users, assigned_by=creator)

    return jsonify(task.to_dict()), 201


@tasks_bp.post("/")
@role_required("site_supervisor", "hq_staff")
def create_task():
    creator_id = get_current_user_id()
    if creator_id is None:
        return jsonify({"msg": "Invalid authentication token"}), 401

    data = request.get_json() or {}
    return _handle_create_task(data, creator_id)


@tasks_bp.post("/create")
@role_required("site_supervisor", "hq_staff")
def create_task_legacy():
    creator_id = get_current_user_id()
    if creator_id is None:
        return jsonify({"msg": "Invalid authentication token"}), 401

    data = request.get_json() or {}
    return _handle_create_task(data, creator_id)


@tasks_bp.get("/<int:task_id>")
@jwt_required()
def get_task(task_id: int):
    task = (
        Task.query.options(
            selectinload(Task.assignees).selectinload(TaskAssignee.user),
            selectinload(Task.assignee),
        )
        .get_or_404(task_id)
    )
    role = (get_jwt() or {}).get("role")
    user_id = get_current_user_id()
    permission_error = _ensure_task_permission(
        task, role, user_id, message="You do not have access to this task"
    )
    if permission_error:
        return permission_error

    return jsonify(_serialize_task_for_viewer(task, role, user_id))


def _apply_task_updates(task: Task, data: dict):
    title = data.get("title")
    description = data.get("description")
    status = data.get("status")
    location = data.get("location")
    expected_time_raw = data.get("expected_time")
    assignee_ids, should_update_assignees = _get_assignee_ids_for_update(data)
    due_date_raw = data.get("due_date")

    summary = {
        "status_changed": False,
        "new_status": None,
        "assignee_added": [],
        "assignee_removed": [],
        "assignee_map": {},
    }

    if title is not None:
        title = title.strip()
        if not title:
            return (jsonify({"msg": "Title is required"}), 400), summary
        task.title = title

    if description is not None:
        description_error = _validate_required_field(description, "Description")
        if description_error:
            return description_error, summary
        task.description = description.strip() if isinstance(description, str) else description

    if location is not None:
        location_error = _validate_required_field(location, "Location")
        if location_error:
            return location_error, summary
        task.location = location.strip() if isinstance(location, str) else location

    if expected_time_raw is not None:
        expected_time, error_response, status_code = _parse_datetime(
            expected_time_raw, "Expected time", required=True
        )
        if error_response:
            return (error_response, status_code), summary
        task.expected_time = expected_time

    if status is not None:
        status_value = status.strip() if isinstance(status, str) else status
        changed, error = _apply_task_status(task, status_value)
        if error:
            return error, summary
        if changed:
            summary["status_changed"] = True
            summary["new_status"] = task.status

    if should_update_assignees:
        assignee_map, error = _load_assignee_users(assignee_ids)
        if error:
            return error, summary
        added_ids, removed_ids = _sync_task_assignees(task, assignee_ids)
        summary["assignee_added"] = added_ids
        summary["assignee_removed"] = removed_ids
        summary["assignee_map"] = assignee_map

    if due_date_raw is not None:
        if due_date_raw in (None, ""):
            task.due_date = None
        else:
            due_date, error_response, status_code = _parse_datetime(due_date_raw, "Due date")
            if error_response:
                return (error_response, status_code), summary
            task.due_date = due_date

    return None, summary
@tasks_bp.put("/<int:task_id>")
@role_required("site_supervisor", "hq_staff")
def update_task(task_id: int):
    actor_id = get_current_user_id()
    task = (
        Task.query.options(
            selectinload(Task.assignees).selectinload(TaskAssignee.user),
            selectinload(Task.assignee),
        )
        .get_or_404(task_id)
    )
    data = request.get_json() or {}
    error, summary = _apply_task_updates(task, data)
    if error:
        return error

    db.session.commit()
    _notify_task_changes(task, summary, actor_id)
    return jsonify(task.to_dict())


@tasks_bp.patch("/update/<int:task_id>")
@role_required("site_supervisor", "hq_staff")
def update_task_patch(task_id: int):
    actor_id = get_current_user_id()
    task = (
        Task.query.options(
            selectinload(Task.assignees).selectinload(TaskAssignee.user),
            selectinload(Task.assignee),
        )
        .get_or_404(task_id)
    )
    data = request.get_json() or {}
    error, summary = _apply_task_updates(task, data)
    if error:
        return error

    db.session.commit()
    _notify_task_changes(task, summary, actor_id)
    return jsonify(task.to_dict())


@tasks_bp.delete("/<int:task_id>")
@role_required("site_supervisor", "hq_staff")
def delete_task(task_id: int):
    task = (
        Task.query.options(
            selectinload(Task.assignees).selectinload(TaskAssignee.user),
            selectinload(Task.attachments),
            selectinload(Task.updates),
            selectinload(Task.assignee),
        )
        .get_or_404(task_id)
    )

    storage = current_app.extensions.get("storage")
    if storage:
        for attachment in list(task.attachments):
            try:
                storage.delete(attachment.file_path)
            except StorageError as exc:
                current_app.logger.warning(
                    "Failed to delete attachment %s for task %s: %s",
                    attachment.file_path,
                    task.id,
                    exc,
                )

    db.session.delete(task)
    db.session.commit()

    return jsonify({"msg": "Task deleted"})


@tasks_bp.post("/<int:task_id>/updates")
@jwt_required()
def add_update(task_id: int):
    task = Task.query.get_or_404(task_id)
    data = request.get_json() or {}
    status = data.get("status")
    note = data.get("note")

    user_id = get_current_user_id()
    role = (get_jwt() or {}).get("role")
    permission_error = _ensure_task_permission(
        task, role, user_id, message="You cannot update this task"
    )
    if permission_error:
        return permission_error

    if not status and not note:
        return jsonify({"msg": "Status or note is required"}), 400

    if status and status not in ALLOWED_STATUSES:
        return jsonify({"msg": "Invalid status"}), 400

    update = TaskUpdate(task_id=task.id, user_id=user_id, status=status, note=note)
    task.updated_at = datetime.utcnow()
    status_changed = False
    if status:
        status_changed, error = _apply_task_status(task, status)
        if error:
            return error
        if not status_changed:
            # ensure completed_at stays populated even if status matches but field missing
            if status == "已完成" and task.completed_at is None:
                task.completed_at = datetime.utcnow()
    db.session.add(update)
    db.session.commit()

    if status_changed:
        actor = User.query.get(user_id)
        recipients = _task_notification_recipients(task)
        notify_task_status_change(task, recipients, updated_by=actor)

    return jsonify(update.to_dict()), 201


@tasks_bp.post("/<int:task_id>/time/start")
@jwt_required()
def start_time_tracking(task_id: int):
    task = Task.query.get_or_404(task_id)
    role = (get_jwt() or {}).get("role")
    user_id = get_current_user_id()
    permission_error = _ensure_task_permission(
        task, role, user_id, message="You cannot start timing for this task"
    )
    if permission_error:
        return permission_error

    active_entry = (
        TaskUpdate.query.filter_by(task_id=task.id, user_id=user_id)
        .filter(TaskUpdate.start_time.isnot(None), TaskUpdate.end_time.is_(None))
        .order_by(TaskUpdate.created_at.desc())
        .first()
    )
    if active_entry:
        return jsonify({"msg": "目前已有進行中的工時紀錄"}), 400

    now = datetime.utcnow()
    entry = TaskUpdate(
        task_id=task.id,
        user_id=user_id,
        start_time=now,
        status="進行中",
    )
    task.updated_at = now
    db.session.add(entry)
    db.session.commit()
    return jsonify(entry.to_time_dict()), 201


@tasks_bp.post("/<int:task_id>/time/stop")
@jwt_required()
def stop_time_tracking(task_id: int):
    task = Task.query.get_or_404(task_id)
    role = (get_jwt() or {}).get("role")
    user_id = get_current_user_id()
    permission_error = _ensure_task_permission(
        task, role, user_id, message="You cannot stop timing for this task"
    )
    if permission_error:
        return permission_error

    active_entry = (
        TaskUpdate.query.filter_by(task_id=task.id, user_id=user_id)
        .filter(TaskUpdate.start_time.isnot(None), TaskUpdate.end_time.is_(None))
        .order_by(TaskUpdate.created_at.desc())
        .first()
    )
    if not active_entry:
        return jsonify({"msg": "尚未開始工時"}), 400

    now = datetime.utcnow()
    active_entry.end_time = now
    if active_entry.start_time:
        delta = now - active_entry.start_time
        active_entry.work_hours = round(delta.total_seconds() / 3600, 2)
    else:
        active_entry.work_hours = 0.0
    task.updated_at = now
    db.session.commit()
    return jsonify(active_entry.to_time_dict())


@tasks_bp.post("/<int:task_id>/attachments")
@jwt_required()
def upload_attachment(task_id: int):
    task = Task.query.get_or_404(task_id)
    role = (get_jwt() or {}).get("role")
    user_id = get_current_user_id()
    permission_error = _ensure_task_permission(
        task, role, user_id, message="You cannot upload for this task"
    )
    if permission_error:
        return permission_error

    if "file" not in request.files:
        return jsonify({"msg": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"msg": "File name is required"}), 400

    file_type = request.form.get("file_type", "other")
    if file_type not in ALLOWED_ATTACHMENT_TYPES:
        file_type = "other"
    note = request.form.get("note")
    transcript = request.form.get("transcript")

    try:
        attachment = create_file_attachment(
            task,
            user_id=user_id,
            uploaded_file=file,
            file_type=file_type,
            note=note,
            transcript=transcript,
        )
    except ValueError as exc:
        return jsonify({"msg": str(exc)}), 400
    except RuntimeError as exc:
        current_app.logger.error("Attachment upload failed: %s", exc)
        return jsonify({"msg": "Unable to store attachment"}), 500

    return jsonify(attachment.to_dict()), 201


@tasks_bp.get("/attachments/<path:filename>")
@jwt_required()
def get_attachment(filename: str):
    storage = current_app.extensions.get("storage")
    if storage is None:
        return jsonify({"msg": "Storage backend is not configured"}), 500

    if hasattr(storage, "local_path"):
        try:
            path = storage.local_path(filename)
        except FileNotFoundError:
            return jsonify({"msg": "File not found"}), 404
        return send_file(path)

    try:
        url = storage.url_for(filename)
    except Exception:
        return jsonify({"msg": "Unable to generate download link"}), 500
    return redirect(url)
