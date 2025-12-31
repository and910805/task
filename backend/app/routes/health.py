from flask import Blueprint, jsonify

health_bp = Blueprint('health', __name__)


@health_bp.route('/hello', methods=['GET'])
def hello():
    """簡單的健康檢查，方便前端確認後端是否正常運行。"""
    return jsonify({'message': 'Backend is running'})


@health_bp.route('/health', methods=['GET'])
def health():
    """標準化的健康檢查端點，供部署後的服務監測使用。"""
    return jsonify({"status": "ok"})
