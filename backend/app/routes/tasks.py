from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Task, Attachment
import os

task_bp = Blueprint('tasks', __name__)

@task_bp.route('/', methods=['GET'])
@jwt_required()
def list_tasks():
    tasks = Task.query.all()
    return jsonify([{
        'id': t.id,
        'title': t.title,
        'status': t.status
    } for t in tasks])

@task_bp.route('/', methods=['POST'])
@jwt_required()
def create_task():
    data = request.json
    task = Task(
        title=data['title'],
        description=data.get('description'),
        assigned_to_id=data.get('assigned_to_id'),
        assigned_by_id=data.get('assigned_by_id')
    )
    db.session.add(task)
    db.session.commit()
    return jsonify({'msg': '任務建立成功'})

@task_bp.route('/<int:id>/upload', methods=['POST'])
@jwt_required()
def upload_file(id):
    if 'file' not in request.files:
        return jsonify({'msg': '未上傳檔案'}), 400

    file = request.files['file']
    filename = file.filename
    path = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
    file.save(path)

    att = Attachment(task_id=id, file_path=filename)
    db.session.add(att)
    db.session.commit()
    return jsonify({'msg': '上傳成功'})
