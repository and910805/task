from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, jwt_required
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import selectinload

from decorators import role_required
from extensions import db
from models import (
    MaterialItem,
    MaterialPurchaseBatch,
    MaterialPurchaseItem,
    MaterialStockTransaction,
    Task,
    TaskAssignee,
    TaskMaterialUsage,
)
from utils import get_current_user_id


materials_bp = Blueprint("materials", __name__)

ALL_ROLES = ("worker", "site_supervisor", "hq_staff", "admin")
MANAGER_ROLES = ("site_supervisor", "hq_staff", "admin")
VALID_TXN_TYPES = {"purchase", "task_use", "adjustment"}


def _now_utc() -> datetime:
    return datetime.utcnow()


def _round_qty(value: float | None) -> float:
    return round(float(value or 0.0), 4)


def _round_money(value: float | None) -> float:
    return round(float(value or 0.0), 2)


def _parse_float(value, field: str, *, minimum: float | None = None) -> tuple[float | None, tuple | None]:
    if value is None or value == "":
        return None, (jsonify({"msg": f"{field} is required"}), 400)
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None, (jsonify({"msg": f"{field} must be a number"}), 400)
    if minimum is not None and parsed < minimum:
        return None, (jsonify({"msg": f"{field} must be >= {minimum}"}), 400)
    return parsed, None


def _parse_date(value, field: str, *, default: date | None = None) -> tuple[date | None, tuple | None]:
    if value in (None, ""):
        return default, None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value, None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return default, None
        try:
            return date.fromisoformat(text), None
        except ValueError:
            return None, (jsonify({"msg": f"{field} must be YYYY-MM-DD"}), 400)
    return None, (jsonify({"msg": f"{field} must be YYYY-MM-DD"}), 400)


def _parse_month(value: str | None, *, default_today: bool = True) -> tuple[str | None, date | None, date | None, tuple | None]:
    raw = (value or "").strip()
    if not raw:
        if not default_today:
            return None, None, None, (jsonify({"msg": "month is required (YYYY-MM)"}), 400)
        today = date.today()
        raw = f"{today.year:04d}-{today.month:02d}"
    parts = raw.split("-")
    if len(parts) != 2:
        return None, None, None, (jsonify({"msg": "month must be YYYY-MM"}), 400)
    try:
        year = int(parts[0])
        month = int(parts[1])
        if month < 1 or month > 12:
            raise ValueError
    except ValueError:
        return None, None, None, (jsonify({"msg": "month must be YYYY-MM"}), 400)
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return f"{year:04d}-{month:02d}", start, end, None


def _statement_month_from_date(purchase_date: date) -> str:
    return f"{purchase_date.year:04d}-{purchase_date.month:02d}"


def _to_txn_datetime(day: date, *, hour: int = 12) -> datetime:
    return datetime.combine(day, time(hour=hour, minute=0))


def _current_role() -> str | None:
    claims = get_jwt() or {}
    role = claims.get("role")
    return role if isinstance(role, str) else None


def _task_accessible(task: Task, role: str | None, user_id: int | None) -> bool:
    if task is None:
        return False
    if role in {"admin", "hq_staff"}:
        return True
    if user_id is None:
        return False
    assigned_ids = {task.assigned_to_id} if task.assigned_to_id else set()
    for assignment in task.assignees or []:
        if assignment.user_id:
            assigned_ids.add(assignment.user_id)
    if role == "worker":
        return user_id in assigned_ids
    if role == "site_supervisor":
        return task.assigned_by_id == user_id or user_id in assigned_ids
    return False


def _get_task_or_403(task_id: int):
    task = (
        Task.query.options(selectinload(Task.assignees))
        .get_or_404(task_id)
    )
    role = _current_role()
    user_id = get_current_user_id()
    if not _task_accessible(task, role, user_id):
        return None, (jsonify({"msg": "You do not have access to this task"}), 403)
    return task, None


def _manager_only_error():
    role = _current_role()
    if role in set(MANAGER_ROLES) | {"admin"}:
        return None
    return jsonify({"msg": "Insufficient permissions"}), 403


def _material_stock_snapshot_map(*, as_of: datetime | None = None, material_item_ids: list[int] | None = None) -> dict[int, dict]:
    query = db.session.query(
        MaterialStockTransaction.material_item_id,
        func.sum(MaterialStockTransaction.qty_delta),
        func.sum(MaterialStockTransaction.amount_delta),
        func.max(MaterialStockTransaction.txn_date),
    )
    if as_of is not None:
        query = query.filter(MaterialStockTransaction.txn_date <= as_of)
    if material_item_ids:
        query = query.filter(MaterialStockTransaction.material_item_id.in_(material_item_ids))
    query = query.group_by(MaterialStockTransaction.material_item_id)

    result: dict[int, dict] = {}
    for material_item_id, qty_sum, amount_sum, last_txn_at in query.all():
        qty = float(qty_sum or 0.0)
        amount = float(amount_sum or 0.0)
        average_cost = (amount / qty) if abs(qty) > 1e-9 else 0.0
        result[int(material_item_id)] = {
            "qty_on_hand": _round_qty(qty),
            "stock_amount": _round_money(amount),
            "average_cost": round(average_cost, 4),
            "last_txn_at": last_txn_at.isoformat() if last_txn_at else None,
        }
    return result


def _current_average_cost(material: MaterialItem) -> float:
    snapshot = _material_stock_snapshot_map(material_item_ids=[material.id]).get(material.id) or {}
    avg = float(snapshot.get("average_cost") or 0.0)
    if avg > 0:
        return round(avg, 4)
    return round(float(material.reference_cost or 0.0), 4)


def _material_item_display_name(item: MaterialItem | None) -> str:
    if not item:
        return ""
    if item.spec:
        return f"{item.name} ({item.spec})"
    return item.name


def _serialize_stock_summary_rows(items: list[MaterialItem], *, as_of: datetime | None = None) -> list[dict]:
    snapshot_map = _material_stock_snapshot_map(as_of=as_of, material_item_ids=[item.id for item in items] if items else None)
    rows: list[dict] = []
    for item in items:
        snapshot = snapshot_map.get(item.id) or {}
        rows.append(
            {
                **item.to_dict(),
                "display_name": _material_item_display_name(item),
                "qty_on_hand": _round_qty(snapshot.get("qty_on_hand")),
                "average_cost": round(float(snapshot.get("average_cost") or item.reference_cost or 0.0), 4),
                "stock_amount": _round_money(snapshot.get("stock_amount")),
                "last_txn_at": snapshot.get("last_txn_at"),
            }
        )
    return rows


def _create_purchase_stock_txn(batch: MaterialPurchaseBatch, purchase_item: MaterialPurchaseItem, *, actor_id: int | None) -> MaterialStockTransaction:
    return MaterialStockTransaction(
        material_item_id=purchase_item.material_item_id,
        txn_type="purchase",
        qty_delta=float(purchase_item.quantity or 0.0),
        unit_cost=float(purchase_item.unit_cost or 0.0),
        amount_delta=float(purchase_item.amount or 0.0),
        txn_date=_to_txn_datetime(batch.purchase_date, hour=12),
        note=f"Purchase batch #{batch.id}",
        purchase_item_id=purchase_item.id,
        created_by_id=actor_id,
    )


def _upsert_usage_stock_txn(usage: TaskMaterialUsage, *, actor_id: int | None) -> None:
    txn = usage.stock_txn
    if txn is None:
        txn = MaterialStockTransaction(task_material_usage_id=usage.id)
        db.session.add(txn)
    txn.material_item_id = usage.material_item_id
    txn.task_id = usage.task_id
    txn.txn_type = "task_use"
    txn.qty_delta = -float(usage.used_qty or 0.0)
    txn.unit_cost = float(usage.unit_cost_snapshot or 0.0)
    txn.amount_delta = -float(usage.total_cost or 0.0)
    txn.txn_date = _to_txn_datetime(usage.used_date, hour=18)
    txn.note = f"Task #{usage.task_id} material usage"
    txn.created_by_id = actor_id


def _normalize_purchase_items(raw_items) -> tuple[list[dict] | None, tuple | None]:
    if not isinstance(raw_items, list) or not raw_items:
        return None, (jsonify({"msg": "items is required and must be a non-empty array"}), 400)

    normalized: list[dict] = []
    for idx, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            return None, (jsonify({"msg": f"items[{idx}] must be an object"}), 400)

        material_item_id = raw.get("material_item_id")
        try:
            material_item_id = int(material_item_id)
        except (TypeError, ValueError):
            return None, (jsonify({"msg": f"items[{idx}].material_item_id is required"}), 400)

        qty, qty_err = _parse_float(raw.get("quantity"), f"items[{idx}].quantity", minimum=0)
        if qty_err:
            return None, qty_err
        unit_cost, cost_err = _parse_float(raw.get("unit_cost"), f"items[{idx}].unit_cost", minimum=0)
        if cost_err:
            return None, cost_err

        quantity = float(qty or 0.0)
        cost = float(unit_cost or 0.0)
        if quantity <= 0:
            return None, (jsonify({"msg": f"items[{idx}].quantity must be > 0"}), 400)
        normalized.append(
            {
                "material_item_id": material_item_id,
                "quantity": quantity,
                "unit_cost": cost,
                "amount": round(quantity * cost, 2),
                "sort_order": idx,
            }
        )
    return normalized, None


@materials_bp.get("/items")
@role_required(*ALL_ROLES)
def list_material_items():
    include_inactive = str(request.args.get("include_inactive") or "").strip().lower() in {"1", "true", "yes"}
    query = MaterialItem.query.order_by(MaterialItem.name.asc(), MaterialItem.spec.asc(), MaterialItem.id.asc())
    if not include_inactive:
        query = query.filter(MaterialItem.is_active.is_(True))
    rows = query.limit(500).all()
    return jsonify([row.to_dict() for row in rows])


@materials_bp.post("/items")
@role_required(*MANAGER_ROLES)
def create_material_item():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    spec = (data.get("spec") or "").strip() or None
    unit = (data.get("unit") or "").strip() or "個"
    if not name:
        return jsonify({"msg": "name is required"}), 400
    ref_cost_raw = data.get("reference_cost", 0)
    try:
        reference_cost = max(float(ref_cost_raw or 0), 0.0)
    except (TypeError, ValueError):
        return jsonify({"msg": "reference_cost must be a number"}), 400

    exists = MaterialItem.query.filter(MaterialItem.name == name, MaterialItem.spec == spec).first()
    if exists is not None:
        return jsonify({"msg": "Material item already exists", "item": exists.to_dict()}), 409

    row = MaterialItem(
        name=name,
        spec=spec,
        unit=unit,
        reference_cost=round(reference_cost, 4),
        is_active=bool(data.get("is_active", True)),
        created_by_id=get_current_user_id(),
    )
    db.session.add(row)
    db.session.commit()
    return jsonify(row.to_dict()), 201


@materials_bp.put("/items/<int:item_id>")
@role_required(*MANAGER_ROLES)
def update_material_item(item_id: int):
    item = MaterialItem.query.get_or_404(item_id)
    data = request.get_json() or {}
    if "name" in data:
        item.name = (data.get("name") or "").strip() or item.name
    if "spec" in data:
        item.spec = (data.get("spec") or "").strip() or None
    if "unit" in data:
        item.unit = (data.get("unit") or "").strip() or item.unit or "個"
    if "reference_cost" in data:
        try:
            item.reference_cost = round(max(float(data.get("reference_cost") or 0), 0.0), 4)
        except (TypeError, ValueError):
            return jsonify({"msg": "reference_cost must be a number"}), 400
    if "is_active" in data:
        item.is_active = bool(data.get("is_active"))
    db.session.commit()
    return jsonify(item.to_dict())


@materials_bp.get("/stock/summary")
@role_required(*ALL_ROLES)
def stock_summary():
    as_of_raw = (request.args.get("as_of") or "").strip()
    as_of = None
    if as_of_raw:
        parsed, err = _parse_date(as_of_raw, "as_of")
        if err:
            return err
        if parsed:
            as_of = datetime.combine(parsed, time.max)

    include_inactive = str(request.args.get("include_inactive") or "").strip().lower() in {"1", "true", "yes"}
    query = MaterialItem.query.order_by(MaterialItem.name.asc(), MaterialItem.spec.asc(), MaterialItem.id.asc())
    if not include_inactive:
        query = query.filter(MaterialItem.is_active.is_(True))
    items = query.limit(1000).all()
    rows = _serialize_stock_summary_rows(items, as_of=as_of)
    return jsonify({"rows": rows, "as_of": as_of.isoformat() if as_of else None})


@materials_bp.get("/stock/transactions")
@role_required(*ALL_ROLES)
def stock_transactions():
    month_raw = request.args.get("month")
    material_item_id = request.args.get("material_item_id", type=int)
    task_id = request.args.get("task_id", type=int)
    limit = max(1, min(int(request.args.get("limit", 200) or 200), 1000))

    query = MaterialStockTransaction.query.options(
        selectinload(MaterialStockTransaction.material_item),
        selectinload(MaterialStockTransaction.task),
    ).order_by(MaterialStockTransaction.txn_date.desc(), MaterialStockTransaction.id.desc())

    if month_raw:
        month_text, month_start, month_end, month_err = _parse_month(month_raw, default_today=False)
        if month_err:
            return month_err
        query = query.filter(
            MaterialStockTransaction.txn_date >= datetime.combine(month_start, time.min),
            MaterialStockTransaction.txn_date < datetime.combine(month_end, time.min),
        )
    else:
        month_text = None

    if material_item_id:
        query = query.filter(MaterialStockTransaction.material_item_id == material_item_id)
    if task_id:
        query = query.filter(MaterialStockTransaction.task_id == task_id)

    rows = query.limit(limit).all()
    payload = []
    for row in rows:
        item = row.to_dict()
        item["task_title"] = row.task.title if row.task else None
        payload.append(item)
    return jsonify({"month": month_text, "rows": payload})


@materials_bp.get("/purchases")
@role_required(*MANAGER_ROLES)
def list_purchase_batches():
    month_raw = request.args.get("month")
    supplier = (request.args.get("supplier") or "").strip()
    query = MaterialPurchaseBatch.query.options(
        selectinload(MaterialPurchaseBatch.items).selectinload(MaterialPurchaseItem.material_item)
    ).order_by(MaterialPurchaseBatch.purchase_date.desc(), MaterialPurchaseBatch.id.desc())

    if month_raw:
        month_text, month_start, month_end, month_err = _parse_month(month_raw, default_today=False)
        if month_err:
            return month_err
        query = query.filter(
            or_(
                MaterialPurchaseBatch.statement_month == month_text,
                and_(
                    MaterialPurchaseBatch.purchase_date >= month_start,
                    MaterialPurchaseBatch.purchase_date < month_end,
                ),
            )
        )
    if supplier:
        query = query.filter(MaterialPurchaseBatch.supplier_name == supplier)

    rows = query.limit(200).all()
    return jsonify([row.to_dict() for row in rows])


@materials_bp.get("/purchases/<int:batch_id>")
@role_required(*MANAGER_ROLES)
def get_purchase_batch(batch_id: int):
    row = MaterialPurchaseBatch.query.options(
        selectinload(MaterialPurchaseBatch.items).selectinload(MaterialPurchaseItem.material_item)
    ).get_or_404(batch_id)
    return jsonify(row.to_dict())


@materials_bp.post("/purchases")
@role_required(*MANAGER_ROLES)
def create_purchase_batch():
    data = request.get_json() or {}
    supplier_name = (data.get("supplier_name") or "").strip()
    if not supplier_name:
        return jsonify({"msg": "supplier_name is required"}), 400

    purchase_date, date_err = _parse_date(data.get("purchase_date"), "purchase_date", default=date.today())
    if date_err:
        return date_err
    assert purchase_date is not None

    statement_month_raw = (data.get("statement_month") or "").strip()
    if statement_month_raw:
        month_text, _, _, month_err = _parse_month(statement_month_raw, default_today=False)
        if month_err:
            return month_err
        statement_month = month_text
    else:
        statement_month = _statement_month_from_date(purchase_date)

    items_payload, items_err = _normalize_purchase_items(data.get("items"))
    if items_err:
        return items_err
    assert items_payload is not None

    material_ids = [item["material_item_id"] for item in items_payload]
    materials = MaterialItem.query.filter(MaterialItem.id.in_(material_ids)).all()
    material_map = {row.id: row for row in materials}
    missing_ids = [item_id for item_id in material_ids if item_id not in material_map]
    if missing_ids:
        return jsonify({"msg": f"Material item not found: {missing_ids[0]}"}), 400

    actor_id = get_current_user_id()
    batch = MaterialPurchaseBatch(
        supplier_name=supplier_name,
        purchase_date=purchase_date,
        statement_month=statement_month or _statement_month_from_date(purchase_date),
        note=(data.get("note") or "").strip() or None,
        created_by_id=actor_id,
    )
    db.session.add(batch)
    db.session.flush()

    for item_data in items_payload:
        purchase_item = MaterialPurchaseItem(batch_id=batch.id, **item_data)
        db.session.add(purchase_item)
        db.session.flush()
        material = material_map.get(purchase_item.material_item_id)
        if material is not None:
            material.reference_cost = round(float(purchase_item.unit_cost or material.reference_cost or 0.0), 4)
        db.session.add(_create_purchase_stock_txn(batch, purchase_item, actor_id=actor_id))

    db.session.commit()
    batch = MaterialPurchaseBatch.query.options(
        selectinload(MaterialPurchaseBatch.items).selectinload(MaterialPurchaseItem.material_item)
    ).get(batch.id)
    return jsonify(batch.to_dict() if batch else {}), 201


@materials_bp.get("/tasks/<int:task_id>/usages")
@jwt_required()
def list_task_material_usages(task_id: int):
    task, task_err = _get_task_or_403(task_id)
    if task_err:
        return task_err

    rows = (
        TaskMaterialUsage.query.options(selectinload(TaskMaterialUsage.material_item))
        .filter(TaskMaterialUsage.task_id == task.id)
        .order_by(TaskMaterialUsage.used_date.desc(), TaskMaterialUsage.id.desc())
        .all()
    )
    total_cost = round(sum(float(row.total_cost or 0.0) for row in rows), 2)
    return jsonify(
        {
            "task_id": task.id,
            "rows": [row.to_dict() for row in rows],
            "total_cost": total_cost,
        }
    )


@materials_bp.post("/tasks/<int:task_id>/usages")
@jwt_required()
def create_task_material_usage(task_id: int):
    task, task_err = _get_task_or_403(task_id)
    if task_err:
        return task_err

    data = request.get_json() or {}
    material_item_id = data.get("material_item_id")
    try:
        material_item_id = int(material_item_id)
    except (TypeError, ValueError):
        return jsonify({"msg": "material_item_id is required"}), 400

    material = MaterialItem.query.get(material_item_id)
    if material is None:
        return jsonify({"msg": "Material item not found"}), 404

    used_qty, qty_err = _parse_float(data.get("used_qty"), "used_qty", minimum=0)
    if qty_err:
        return qty_err
    if float(used_qty or 0) <= 0:
        return jsonify({"msg": "used_qty must be > 0"}), 400

    used_date, date_err = _parse_date(data.get("used_date"), "used_date", default=date.today())
    if date_err:
        return date_err
    assert used_date is not None

    unit_cost_raw = data.get("unit_cost_snapshot")
    if unit_cost_raw in (None, ""):
        unit_cost = _current_average_cost(material)
    else:
        parsed_cost, cost_err = _parse_float(unit_cost_raw, "unit_cost_snapshot", minimum=0)
        if cost_err:
            return cost_err
        unit_cost = round(float(parsed_cost or 0.0), 4)

    total_cost = round(float(used_qty or 0.0) * float(unit_cost or 0.0), 2)
    actor_id = get_current_user_id()
    usage = TaskMaterialUsage(
        task_id=task.id,
        material_item_id=material.id,
        used_qty=round(float(used_qty or 0.0), 4),
        unit_cost_snapshot=unit_cost,
        total_cost=total_cost,
        used_date=used_date,
        note=(data.get("note") or "").strip() or None,
        created_by_id=actor_id,
    )
    db.session.add(usage)
    db.session.flush()
    _upsert_usage_stock_txn(usage, actor_id=actor_id)
    db.session.commit()
    usage = TaskMaterialUsage.query.options(selectinload(TaskMaterialUsage.material_item)).get(usage.id)
    return jsonify(usage.to_dict() if usage else {}), 201


@materials_bp.put("/tasks/<int:task_id>/usages/<int:usage_id>")
@jwt_required()
def update_task_material_usage(task_id: int, usage_id: int):
    task, task_err = _get_task_or_403(task_id)
    if task_err:
        return task_err

    usage = TaskMaterialUsage.query.options(selectinload(TaskMaterialUsage.material_item)).filter(
        TaskMaterialUsage.id == usage_id,
        TaskMaterialUsage.task_id == task.id,
    ).first()
    if usage is None:
        return jsonify({"msg": "Task material usage not found"}), 404

    data = request.get_json() or {}
    if "material_item_id" in data:
        try:
            new_material_id = int(data.get("material_item_id"))
        except (TypeError, ValueError):
            return jsonify({"msg": "material_item_id must be an integer"}), 400
        material = MaterialItem.query.get(new_material_id)
        if material is None:
            return jsonify({"msg": "Material item not found"}), 404
        usage.material_item_id = new_material_id
    else:
        material = usage.material_item or MaterialItem.query.get(usage.material_item_id)

    if "used_qty" in data:
        used_qty, qty_err = _parse_float(data.get("used_qty"), "used_qty", minimum=0)
        if qty_err:
            return qty_err
        if float(used_qty or 0) <= 0:
            return jsonify({"msg": "used_qty must be > 0"}), 400
        usage.used_qty = round(float(used_qty or 0.0), 4)

    if "used_date" in data:
        used_date, date_err = _parse_date(data.get("used_date"), "used_date", default=usage.used_date or date.today())
        if date_err:
            return date_err
        usage.used_date = used_date or usage.used_date

    if "unit_cost_snapshot" in data:
        if data.get("unit_cost_snapshot") in (None, ""):
            usage.unit_cost_snapshot = _current_average_cost(material) if material else float(usage.unit_cost_snapshot or 0)
        else:
            parsed_cost, cost_err = _parse_float(data.get("unit_cost_snapshot"), "unit_cost_snapshot", minimum=0)
            if cost_err:
                return cost_err
            usage.unit_cost_snapshot = round(float(parsed_cost or 0.0), 4)

    if "note" in data:
        usage.note = (data.get("note") or "").strip() or None

    usage.total_cost = round(float(usage.used_qty or 0.0) * float(usage.unit_cost_snapshot or 0.0), 2)
    _upsert_usage_stock_txn(usage, actor_id=get_current_user_id())
    db.session.commit()
    usage = TaskMaterialUsage.query.options(selectinload(TaskMaterialUsage.material_item)).get(usage.id)
    return jsonify(usage.to_dict() if usage else {})


@materials_bp.delete("/tasks/<int:task_id>/usages/<int:usage_id>")
@jwt_required()
def delete_task_material_usage(task_id: int, usage_id: int):
    task, task_err = _get_task_or_403(task_id)
    if task_err:
        return task_err

    usage = TaskMaterialUsage.query.filter(
        TaskMaterialUsage.id == usage_id,
        TaskMaterialUsage.task_id == task.id,
    ).first()
    if usage is None:
        return jsonify({"msg": "Task material usage not found"}), 404

    if usage.stock_txn is not None:
        db.session.delete(usage.stock_txn)
    db.session.delete(usage)
    db.session.commit()
    return jsonify({"msg": "Task material usage deleted"})


@materials_bp.get("/reports/monthly")
@role_required(*MANAGER_ROLES)
def monthly_material_report():
    month_text, month_start, month_end, month_err = _parse_month(request.args.get("month"), default_today=True)
    if month_err:
        return month_err
    assert month_text is not None and month_start is not None and month_end is not None

    month_start_dt = datetime.combine(month_start, time.min)
    month_end_dt = datetime.combine(month_end, time.min)

    items = MaterialItem.query.order_by(MaterialItem.name.asc(), MaterialItem.spec.asc(), MaterialItem.id.asc()).all()
    item_map = {item.id: item for item in items}

    txns = (
        MaterialStockTransaction.query.options(selectinload(MaterialStockTransaction.material_item))
        .filter(MaterialStockTransaction.txn_date < month_end_dt)
        .order_by(MaterialStockTransaction.txn_date.asc(), MaterialStockTransaction.id.asc())
        .all()
    )

    opening_qty = defaultdict(float)
    opening_amount = defaultdict(float)
    purchased_qty = defaultdict(float)
    purchased_amount = defaultdict(float)
    used_qty = defaultdict(float)
    used_amount = defaultdict(float)
    closing_qty = defaultdict(float)
    closing_amount = defaultdict(float)

    for txn in txns:
        material_id = int(txn.material_item_id)
        qty_delta = float(txn.qty_delta or 0.0)
        amount_delta = float(txn.amount_delta or 0.0)
        txn_date = txn.txn_date or _now_utc()

        if txn_date < month_start_dt:
            opening_qty[material_id] += qty_delta
            opening_amount[material_id] += amount_delta

        if month_start_dt <= txn_date < month_end_dt:
            if txn.txn_type == "purchase":
                purchased_qty[material_id] += qty_delta
                purchased_amount[material_id] += amount_delta
            elif txn.txn_type == "task_use":
                used_qty[material_id] += abs(qty_delta)
                used_amount[material_id] += abs(amount_delta)

        closing_qty[material_id] += qty_delta
        closing_amount[material_id] += amount_delta

    per_material_rows: list[dict] = []
    for item in items:
        material_id = item.id
        close_qty = float(closing_qty.get(material_id, 0.0))
        close_amt = float(closing_amount.get(material_id, 0.0))
        avg_cost = (close_amt / close_qty) if abs(close_qty) > 1e-9 else float(item.reference_cost or 0.0)
        per_material_rows.append(
            {
                "material_item_id": material_id,
                "display_name": _material_item_display_name(item),
                "name": item.name,
                "spec": item.spec,
                "unit": item.unit,
                "opening_qty": _round_qty(opening_qty.get(material_id)),
                "opening_amount": _round_money(opening_amount.get(material_id)),
                "purchased_qty": _round_qty(purchased_qty.get(material_id)),
                "purchase_amount": _round_money(purchased_amount.get(material_id)),
                "used_qty": _round_qty(used_qty.get(material_id)),
                "used_amount": _round_money(used_amount.get(material_id)),
                "closing_qty": _round_qty(close_qty),
                "closing_amount": _round_money(close_amt),
                "average_cost": round(avg_cost, 4),
            }
        )

    # Supplier totals based on purchase batches in the selected month.
    purchase_batches = (
        MaterialPurchaseBatch.query.options(
            selectinload(MaterialPurchaseBatch.items)
        )
        .filter(
            or_(
                MaterialPurchaseBatch.statement_month == month_text,
                and_(
                    MaterialPurchaseBatch.purchase_date >= month_start,
                    MaterialPurchaseBatch.purchase_date < month_end,
                ),
            )
        )
        .order_by(MaterialPurchaseBatch.purchase_date.asc(), MaterialPurchaseBatch.id.asc())
        .all()
    )
    supplier_summary = defaultdict(lambda: {"supplier_name": "", "batch_count": 0, "total_amount": 0.0})
    purchase_batches_payload = []
    for batch in purchase_batches:
        batch_total = batch.total_amount()
        supplier = (batch.supplier_name or "").strip() or "未指定材料行"
        supplier_row = supplier_summary[supplier]
        supplier_row["supplier_name"] = supplier
        supplier_row["batch_count"] += 1
        supplier_row["total_amount"] += batch_total
        purchase_batches_payload.append(
            {
                "id": batch.id,
                "supplier_name": supplier,
                "purchase_date": batch.purchase_date.isoformat() if batch.purchase_date else None,
                "statement_month": batch.statement_month,
                "total_amount": batch_total,
                "item_count": len(batch.items or []),
            }
        )

    supplier_rows = [
        {
            **row,
            "total_amount": _round_money(row["total_amount"]),
        }
        for row in supplier_summary.values()
    ]
    supplier_rows.sort(key=lambda row: (-float(row["total_amount"] or 0.0), row["supplier_name"]))

    summary = {
        "month": month_text,
        "purchase_total_amount": _round_money(sum(row["purchase_amount"] for row in per_material_rows)),
        "usage_total_amount": _round_money(sum(row["used_amount"] for row in per_material_rows)),
        "opening_stock_amount": _round_money(sum(row["opening_amount"] for row in per_material_rows)),
        "closing_stock_amount": _round_money(sum(row["closing_amount"] for row in per_material_rows)),
        "material_item_count": len(per_material_rows),
        "supplier_count": len(supplier_rows),
        "purchase_batch_count": len(purchase_batches_payload),
    }

    return jsonify(
        {
            "summary": summary,
            "materials": per_material_rows,
            "suppliers": supplier_rows,
            "purchase_batches": purchase_batches_payload,
        }
    )

