from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from decorators import role_required
from extensions import db
from models import RoleLabel, ROLE_LABEL_DEFAULTS


settings_bp = Blueprint("settings", __name__)


def _serialize_role_labels():
    overrides = RoleLabel.get_overrides()
    labels = {**ROLE_LABEL_DEFAULTS, **overrides}
    return overrides, labels


@settings_bp.get("/roles")
@jwt_required(optional=True)
def get_role_labels():
    overrides, labels = _serialize_role_labels()
    return jsonify(
        {
            "labels": labels,
            "overrides": overrides,
            "defaults": ROLE_LABEL_DEFAULTS,
        }
    )


@settings_bp.put("/roles/<string:role>")
@role_required("admin")
def update_role_label(role: str):
    if role not in ROLE_LABEL_DEFAULTS:
        return jsonify({"msg": "Unknown role"}), 400

    data = request.get_json(silent=True) or {}
    label = (data.get("label") or "").strip()

    if not label:
        return jsonify({"msg": "顯示名稱不可為空白"}), 400

    record = RoleLabel.query.filter_by(role=role).first()
    if record:
        record.label = label
    else:
        record = RoleLabel(role=role, label=label)
        db.session.add(record)

    db.session.commit()
    RoleLabel.clear_cache()

    overrides, labels = _serialize_role_labels()
    return jsonify({"labels": labels, "overrides": overrides})


@settings_bp.delete("/roles/<string:role>")
@role_required("admin")
def reset_role_label(role: str):
    if role not in ROLE_LABEL_DEFAULTS:
        return jsonify({"msg": "Unknown role"}), 400

    record = RoleLabel.query.filter_by(role=role).first()
    if record:
        db.session.delete(record)
        db.session.commit()
        RoleLabel.clear_cache()

    overrides, labels = _serialize_role_labels()
    return jsonify({"labels": labels, "overrides": overrides})
