from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from app import db
from app.models import User
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    role = data.get('role', 'worker')

    if User.query.filter_by(username=username).first():
        return jsonify({'msg': '使用者已存在'}), 400

    user = User(username=username,
                password_hash=generate_password_hash(password),
                role=role)
    db.session.add(user)
    db.session.commit()
    return jsonify({'msg': '註冊成功'})

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')

    user = User.query.filter_by(username=username).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'msg': '帳號或密碼錯誤'}), 401

    token = create_access_token(identity={'id': user.id, 'role': user.role})
    return jsonify({'token': token, 'role': user.role})
@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    # 如果未來需要實作 Token 黑名單 (Blacklist)，會在這裡處理
    # 目前僅回傳成功訊息，告知前端連線正常
    return jsonify({'msg': '登出成功'}), 200