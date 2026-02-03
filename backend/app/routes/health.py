from flask import Blueprint, jsonify

health_bp = Blueprint("health", __name__)


@health_bp.route("/hello", methods=["GET"])
def hello():
    return jsonify({"message": "Backend is running"})


@health_bp.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})
