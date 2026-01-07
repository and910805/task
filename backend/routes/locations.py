from sqlalchemy import func

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from decorators import role_required
from extensions import db
from models import SiteLocation


site_locations_bp = Blueprint("site_locations", __name__)


def _normalize_map_url(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    if not value.startswith(("http://", "https://")):
        raise ValueError("Google Maps 連結需包含 http 或 https")
    return value


@site_locations_bp.get("/")
@jwt_required()
def list_site_locations():
    locations = SiteLocation.query.order_by(SiteLocation.name.asc()).all()
    return jsonify([location.to_dict() for location in locations])


@site_locations_bp.post("/")
@role_required("admin")
def create_site_location():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "地點名稱為必填欄位"}), 400

    try:
        map_url = _normalize_map_url(data.get("map_url"))
    except ValueError as exc:
        return jsonify({"msg": str(exc)}), 400

    existing = SiteLocation.query.filter(func.lower(SiteLocation.name) == name.lower()).first()
    if existing:
        return jsonify({"msg": "地點名稱已存在"}), 400

    location = SiteLocation(name=name, map_url=map_url)
    db.session.add(location)
    db.session.commit()
    return jsonify(location.to_dict()), 201


@site_locations_bp.put("/<int:location_id>")
@role_required("admin")
def update_site_location(location_id: int):
    location = SiteLocation.query.get(location_id)
    if not location:
        return jsonify({"msg": "找不到指定的地點"}), 404

    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "地點名稱為必填欄位"}), 400

    try:
        map_url = _normalize_map_url(data.get("map_url"))
    except ValueError as exc:
        return jsonify({"msg": str(exc)}), 400

    existing = (
        SiteLocation.query.filter(func.lower(SiteLocation.name) == name.lower())
        .filter(SiteLocation.id != location_id)
        .first()
    )
    if existing:
        return jsonify({"msg": "地點名稱已存在"}), 400

    location.name = name
    location.map_url = map_url
    db.session.commit()
    return jsonify(location.to_dict())


@site_locations_bp.delete("/<int:location_id>")
@role_required("admin")
def delete_site_location(location_id: int):
    location = SiteLocation.query.get(location_id)
    if not location:
        return jsonify({"msg": "找不到指定的地點"}), 404

    db.session.delete(location)
    db.session.commit()
    return jsonify({"msg": "已刪除地點"}), 200
