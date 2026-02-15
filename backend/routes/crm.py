from __future__ import annotations

from datetime import date, datetime
from io import BytesIO
import os

from flask import Blueprint, jsonify, request, send_file
from flask_jwt_extended import jwt_required
from sqlalchemy.orm import selectinload

from decorators import role_required
from extensions import db
from models import Contact, Customer, Invoice, InvoiceItem, Quote, QuoteItem
from utils import get_current_user_id

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

crm_bp = Blueprint("crm", __name__)

READ_ROLES = ("site_supervisor", "hq_staff", "admin")
WRITE_ROLES = ("site_supervisor", "hq_staff", "admin")
VALID_QUOTE_STATUS = {"draft", "sent", "accepted", "rejected", "expired"}
VALID_INVOICE_STATUS = {"draft", "issued", "partially_paid", "paid", "cancelled"}

PDF_FONT_NAME = "Helvetica"
PDF_FONT_ENV = "PDF_FONT_PATH"


def _ensure_pdf_font():
    font_path = os.environ.get(PDF_FONT_ENV, "").strip()
    if not font_path:
        return
    if not os.path.exists(font_path):
        return
    try:
        pdfmetrics.registerFont(TTFont("CustomFont", font_path))
    except Exception:
        return
    global PDF_FONT_NAME
    PDF_FONT_NAME = "CustomFont"


def _parse_date(raw, field_name: str):
    if raw in (None, ""):
        return None, None
    if isinstance(raw, date):
        return raw, None
    try:
        return date.fromisoformat(str(raw)), None
    except ValueError:
        return None, (jsonify({"msg": f"Invalid {field_name} format, expected YYYY-MM-DD"}), 400)


def _parse_float(raw, field_name: str, *, minimum: float | None = None):
    if raw in (None, ""):
        return None, None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None, (jsonify({"msg": f"{field_name} must be a number"}), 400)
    if minimum is not None and value < minimum:
        return None, (jsonify({"msg": f"{field_name} must be >= {minimum}"}), 400)
    return value, None


def _normalize_items(raw_items):
    if not isinstance(raw_items, list) or not raw_items:
        return None, (jsonify({"msg": "items is required and must be a non-empty array"}), 400)

    normalized = []
    for idx, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            return None, (jsonify({"msg": f"items[{idx}] must be an object"}), 400)

        description = (raw.get("description") or "").strip()
        if not description:
            return None, (jsonify({"msg": f"items[{idx}].description is required"}), 400)

        qty, qty_err = _parse_float(raw.get("quantity", 1), f"items[{idx}].quantity", minimum=0)
        if qty_err:
            return None, qty_err
        unit_price, price_err = _parse_float(raw.get("unit_price", 0), f"items[{idx}].unit_price", minimum=0)
        if price_err:
            return None, price_err

        quantity = qty if qty is not None else 1.0
        unit = unit_price if unit_price is not None else 0.0
        amount = round(quantity * unit, 2)
        normalized.append(
            {
                "description": description,
                "quantity": quantity,
                "unit_price": unit,
                "amount": amount,
                "sort_order": idx,
            }
        )

    return normalized, None


def _apply_totals(entity, items: list[dict], tax_rate_raw):
    subtotal = round(sum(item["amount"] for item in items), 2)
    tax_rate, tax_rate_err = _parse_float(tax_rate_raw, "tax_rate", minimum=0)
    if tax_rate_err:
        return tax_rate_err

    safe_tax_rate = round(tax_rate or 0.0, 2)
    tax_amount = round(subtotal * safe_tax_rate / 100.0, 2)
    total_amount = round(subtotal + tax_amount, 2)

    entity.subtotal = subtotal
    entity.tax_rate = safe_tax_rate
    entity.tax_amount = tax_amount
    entity.total_amount = total_amount
    return None


def _next_doc_no(prefix: str) -> str:
    return f"{prefix}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')[:-3]}"


def _validate_customer_contact(customer_id, contact_id):
    customer = Customer.query.get(customer_id)
    if not customer:
        return None, None, (jsonify({"msg": "Customer not found"}), 404)

    contact = None
    if contact_id is not None:
        contact = Contact.query.get(contact_id)
        if not contact:
            return None, None, (jsonify({"msg": "Contact not found"}), 404)
        if contact.customer_id != customer.id:
            return None, None, (jsonify({"msg": "Contact does not belong to this customer"}), 400)

    return customer, contact, None


def _build_pdf_document(title: str, meta_rows: list[list[str]], item_rows: list[list[str]], totals_rows: list[list[str]]):
    _ensure_pdf_font()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=title,
    )
    styles = getSampleStyleSheet()
    styles["Normal"].fontName = PDF_FONT_NAME
    styles["Heading1"].fontName = PDF_FONT_NAME

    story = [
        Paragraph(title, styles["Heading1"]),
        Spacer(1, 8 * mm),
    ]

    meta_table = Table(meta_rows, hAlign="LEFT", colWidths=[45 * mm, 120 * mm])
    meta_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), PDF_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#111827")),
            ]
        )
    )
    story.extend([meta_table, Spacer(1, 6 * mm)])

    items_table = Table(item_rows, hAlign="LEFT", colWidths=[80 * mm, 25 * mm, 30 * mm, 30 * mm])
    items_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), PDF_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5f5")),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ]
        )
    )
    story.extend([items_table, Spacer(1, 6 * mm)])

    totals_table = Table(totals_rows, hAlign="RIGHT", colWidths=[35 * mm, 35 * mm])
    totals_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), PDF_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#111827")),
            ]
        )
    )
    story.append(totals_table)

    doc.build(story)
    buffer.seek(0)
    return buffer


def _trim(value):
    return (value or "").strip()


def _append_note(original: str | None, extra: str) -> str:
    current = _trim(original)
    return f"{current}\n{extra}" if current else extra


def _find_or_create_customer(name: str, phone: str, email: str, address: str, note_line: str):
    customer = None
    if phone:
        customer = Customer.query.filter(Customer.phone == phone).first()
    if not customer and email:
        customer = Customer.query.filter(Customer.email == email).first()
    if not customer and name:
        customer = Customer.query.filter(Customer.name == name).first()

    if customer:
        if phone and not customer.phone:
            customer.phone = phone
        if email and not customer.email:
            customer.email = email
        if address and not customer.address:
            customer.address = address
        customer.note = _append_note(customer.note, note_line)
        return customer

    base_name = name or f"網站預約-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    candidate = base_name
    suffix = 2
    while Customer.query.filter(Customer.name == candidate).first():
        candidate = f"{base_name}-{suffix}"
        suffix += 1

    customer = Customer(
        name=candidate,
        email=email or None,
        phone=phone or None,
        address=address or None,
        note=note_line,
        created_by_id=None,
    )
    db.session.add(customer)
    db.session.flush()
    return customer


def _find_or_create_contact(customer: Customer, name: str, phone: str, email: str, note_line: str):
    contact = None
    if email:
        contact = Contact.query.filter(
            Contact.customer_id == customer.id,
            Contact.email == email,
        ).first()
    if not contact and phone:
        contact = Contact.query.filter(
            Contact.customer_id == customer.id,
            Contact.phone == phone,
            Contact.name == name,
        ).first()

    if contact:
        if phone and not contact.phone:
            contact.phone = phone
        if email and not contact.email:
            contact.email = email
        contact.note = _append_note(contact.note, note_line)
        return contact

    is_primary = Contact.query.filter(Contact.customer_id == customer.id).count() == 0
    contact = Contact(
        customer_id=customer.id,
        name=name or customer.name,
        email=email or None,
        phone=phone or None,
        is_primary=is_primary,
        note=note_line,
    )
    db.session.add(contact)
    db.session.flush()
    return contact


@crm_bp.post("/public/bookings")
def create_public_booking():
    data = request.get_json(silent=True) or {}
    name = _trim(data.get("name"))
    phone = _trim(data.get("phone"))
    email = _trim(data.get("email"))
    service = _trim(data.get("service"))
    message = _trim(data.get("message"))
    address = _trim(data.get("address"))
    source_url = _trim(data.get("source_url")) or _trim(request.referrer)
    user_agent = _trim(request.headers.get("User-Agent"))
    client_ip = _trim((request.headers.get("X-Forwarded-For") or "").split(",")[0]) or _trim(request.remote_addr)

    if not name:
        return jsonify({"msg": "name is required"}), 400
    if not phone:
        return jsonify({"msg": "phone is required"}), 400
    if not service:
        return jsonify({"msg": "service is required"}), 400

    booking_note_parts = [
        "來源: 官網線上預約",
        f"服務項目: {service}",
    ]
    if message:
        booking_note_parts.append(f"需求描述: {message}")
    if source_url:
        booking_note_parts.append(f"來源頁面: {source_url}")
    if client_ip:
        booking_note_parts.append(f"IP: {client_ip}")
    if user_agent:
        booking_note_parts.append(f"UA: {user_agent}")
    booking_note = "\n".join(booking_note_parts)

    customer = _find_or_create_customer(
        name=name,
        phone=phone,
        email=email,
        address=address,
        note_line=booking_note,
    )
    contact = _find_or_create_contact(
        customer=customer,
        name=name,
        phone=phone,
        email=email,
        note_line=booking_note,
    )
    db.session.commit()

    return (
        jsonify(
            {
                "msg": "booking received",
                "customer_id": customer.id,
                "contact_id": contact.id,
            }
        ),
        201,
    )


@crm_bp.get("/customers")
@role_required(*READ_ROLES)
def list_customers():
    q = (request.args.get("q") or "").strip()
    query = Customer.query.order_by(Customer.updated_at.desc())
    if q:
        pattern = f"%{q}%"
        query = query.filter(Customer.name.ilike(pattern))
    customers = query.limit(200).all()
    return jsonify([item.to_dict() for item in customers])


@crm_bp.post("/customers")
@role_required(*WRITE_ROLES)
def create_customer():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "name is required"}), 400

    exists = Customer.query.filter(Customer.name == name).first()
    if exists:
        return jsonify({"msg": "Customer name already exists"}), 400

    customer = Customer(
        name=name,
        tax_id=(data.get("tax_id") or "").strip() or None,
        email=(data.get("email") or "").strip() or None,
        phone=(data.get("phone") or "").strip() or None,
        address=(data.get("address") or "").strip() or None,
        note=(data.get("note") or "").strip() or None,
        created_by_id=get_current_user_id(),
    )
    db.session.add(customer)
    db.session.commit()
    return jsonify(customer.to_dict()), 201


@crm_bp.get("/customers/<int:customer_id>")
@role_required(*READ_ROLES)
def get_customer(customer_id: int):
    customer = Customer.query.get_or_404(customer_id)
    payload = customer.to_dict()
    payload["contacts"] = [contact.to_dict() for contact in customer.contacts]
    return jsonify(payload)


@crm_bp.put("/customers/<int:customer_id>")
@role_required(*WRITE_ROLES)
def update_customer(customer_id: int):
    customer = Customer.query.get_or_404(customer_id)
    data = request.get_json() or {}

    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"msg": "name is required"}), 400
        duplicate = Customer.query.filter(Customer.name == name, Customer.id != customer_id).first()
        if duplicate:
            return jsonify({"msg": "Customer name already exists"}), 400
        customer.name = name

    for key in ("tax_id", "email", "phone", "address", "note"):
        if key in data:
            value = data.get(key)
            customer.__setattr__(key, (value or "").strip() or None)

    db.session.commit()
    return jsonify(customer.to_dict())


@crm_bp.get("/contacts")
@role_required(*READ_ROLES)
def list_contacts():
    customer_id = request.args.get("customer_id", type=int)
    query = Contact.query.order_by(Contact.updated_at.desc())
    if customer_id:
        query = query.filter(Contact.customer_id == customer_id)
    contacts = query.limit(300).all()
    return jsonify([item.to_dict() for item in contacts])


@crm_bp.post("/contacts")
@role_required(*WRITE_ROLES)
def create_contact():
    data = request.get_json() or {}
    customer_id = data.get("customer_id")
    name = (data.get("name") or "").strip()

    if not customer_id:
        return jsonify({"msg": "customer_id is required"}), 400
    if not name:
        return jsonify({"msg": "name is required"}), 400

    customer = Customer.query.get(customer_id)
    if not customer:
        return jsonify({"msg": "Customer not found"}), 404

    contact = Contact(
        customer_id=customer.id,
        name=name,
        title=(data.get("title") or "").strip() or None,
        email=(data.get("email") or "").strip() or None,
        phone=(data.get("phone") or "").strip() or None,
        is_primary=bool(data.get("is_primary")),
        note=(data.get("note") or "").strip() or None,
    )
    db.session.add(contact)
    db.session.commit()
    return jsonify(contact.to_dict()), 201


@crm_bp.put("/contacts/<int:contact_id>")
@role_required(*WRITE_ROLES)
def update_contact(contact_id: int):
    contact = Contact.query.get_or_404(contact_id)
    data = request.get_json() or {}

    if "customer_id" in data:
        next_customer = Customer.query.get(data.get("customer_id"))
        if not next_customer:
            return jsonify({"msg": "Customer not found"}), 404
        contact.customer_id = next_customer.id

    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"msg": "name is required"}), 400
        contact.name = name

    for key in ("title", "email", "phone", "note"):
        if key in data:
            value = data.get(key)
            contact.__setattr__(key, (value or "").strip() or None)

    if "is_primary" in data:
        contact.is_primary = bool(data.get("is_primary"))

    db.session.commit()
    return jsonify(contact.to_dict())


@crm_bp.get("/quotes")
@role_required(*READ_ROLES)
def list_quotes():
    query = Quote.query.options(selectinload(Quote.items)).order_by(Quote.updated_at.desc())
    customer_id = request.args.get("customer_id", type=int)
    status = (request.args.get("status") or "").strip().lower()

    if customer_id:
        query = query.filter(Quote.customer_id == customer_id)
    if status:
        query = query.filter(Quote.status == status)

    rows = query.limit(200).all()
    return jsonify([row.to_dict() for row in rows])


@crm_bp.post("/quotes")
@role_required(*WRITE_ROLES)
def create_quote():
    data = request.get_json() or {}
    customer_id = data.get("customer_id")
    contact_id = data.get("contact_id")
    status = (data.get("status") or "draft").strip().lower()
    if status not in VALID_QUOTE_STATUS:
        return jsonify({"msg": "Invalid quote status"}), 400

    if not customer_id:
        return jsonify({"msg": "customer_id is required"}), 400
    _, _, cc_err = _validate_customer_contact(customer_id, contact_id)
    if cc_err:
        return cc_err

    items, items_err = _normalize_items(data.get("items"))
    if items_err:
        return items_err

    issue_date, issue_err = _parse_date(data.get("issue_date"), "issue_date")
    if issue_err:
        return issue_err
    expiry_date, expiry_err = _parse_date(data.get("expiry_date"), "expiry_date")
    if expiry_err:
        return expiry_err

    quote = Quote(
        quote_no=(data.get("quote_no") or "").strip() or _next_doc_no("QT"),
        status=status,
        customer_id=customer_id,
        contact_id=contact_id,
        issue_date=issue_date,
        expiry_date=expiry_date,
        currency=(data.get("currency") or "TWD").strip().upper() or "TWD",
        note=(data.get("note") or "").strip() or None,
        created_by_id=get_current_user_id(),
    )

    total_err = _apply_totals(quote, items, data.get("tax_rate", 0))
    if total_err:
        return total_err

    db.session.add(quote)
    db.session.flush()

    for item in items:
        db.session.add(QuoteItem(quote_id=quote.id, **item))

    db.session.commit()
    quote = Quote.query.options(selectinload(Quote.items)).get(quote.id)
    return jsonify(quote.to_dict()), 201


@crm_bp.put("/quotes/<int:quote_id>")
@role_required(*WRITE_ROLES)
def update_quote(quote_id: int):
    quote = Quote.query.options(selectinload(Quote.items)).get_or_404(quote_id)
    data = request.get_json() or {}

    if "status" in data:
        status = (data.get("status") or "").strip().lower()
        if status not in VALID_QUOTE_STATUS:
            return jsonify({"msg": "Invalid quote status"}), 400
        quote.status = status

    next_customer_id = data.get("customer_id", quote.customer_id)
    next_contact_id = data.get("contact_id", quote.contact_id)
    _, _, cc_err = _validate_customer_contact(next_customer_id, next_contact_id)
    if cc_err:
        return cc_err
    quote.customer_id = next_customer_id
    quote.contact_id = next_contact_id

    if "issue_date" in data:
        parsed, err = _parse_date(data.get("issue_date"), "issue_date")
        if err:
            return err
        quote.issue_date = parsed

    if "expiry_date" in data:
        parsed, err = _parse_date(data.get("expiry_date"), "expiry_date")
        if err:
            return err
        quote.expiry_date = parsed

    if "currency" in data:
        quote.currency = (data.get("currency") or "TWD").strip().upper() or "TWD"
    if "note" in data:
        quote.note = (data.get("note") or "").strip() or None

    if "items" in data:
        items, items_err = _normalize_items(data.get("items"))
        if items_err:
            return items_err
        quote.items.clear()
        db.session.flush()
        for item in items:
            db.session.add(QuoteItem(quote_id=quote.id, **item))
        total_err = _apply_totals(quote, items, data.get("tax_rate", quote.tax_rate))
    elif "tax_rate" in data:
        items = [item.to_dict() for item in quote.items]
        total_err = _apply_totals(quote, items, data.get("tax_rate", quote.tax_rate))
    else:
        total_err = None

    if total_err:
        return total_err

    db.session.commit()
    quote = Quote.query.options(selectinload(Quote.items)).get(quote.id)
    return jsonify(quote.to_dict())


@crm_bp.post("/quotes/<int:quote_id>/convert-to-invoice")
@role_required(*WRITE_ROLES)
def convert_quote_to_invoice(quote_id: int):
    quote = Quote.query.options(selectinload(Quote.items)).get_or_404(quote_id)
    if not quote.items:
        return jsonify({"msg": "Quote has no items"}), 400

    invoice = Invoice(
        invoice_no=_next_doc_no("INV"),
        status="issued",
        customer_id=quote.customer_id,
        contact_id=quote.contact_id,
        quote_id=quote.id,
        issue_date=date.today(),
        due_date=date.today(),
        currency=quote.currency,
        subtotal=quote.subtotal,
        tax_rate=quote.tax_rate,
        tax_amount=quote.tax_amount,
        total_amount=quote.total_amount,
        note=quote.note,
        created_by_id=get_current_user_id(),
    )
    db.session.add(invoice)
    db.session.flush()

    for item in quote.items:
        db.session.add(
            InvoiceItem(
                invoice_id=invoice.id,
                description=item.description,
                quantity=item.quantity,
                unit_price=item.unit_price,
                amount=item.amount,
                sort_order=item.sort_order,
            )
        )

    db.session.commit()
    invoice = Invoice.query.options(selectinload(Invoice.items)).get(invoice.id)
    return jsonify(invoice.to_dict()), 201


@crm_bp.get("/invoices")
@role_required(*READ_ROLES)
def list_invoices():
    query = Invoice.query.options(selectinload(Invoice.items)).order_by(Invoice.updated_at.desc())
    customer_id = request.args.get("customer_id", type=int)
    status = (request.args.get("status") or "").strip().lower()

    if customer_id:
        query = query.filter(Invoice.customer_id == customer_id)
    if status:
        query = query.filter(Invoice.status == status)

    rows = query.limit(200).all()
    return jsonify([row.to_dict() for row in rows])


@crm_bp.post("/invoices")
@role_required(*WRITE_ROLES)
def create_invoice():
    data = request.get_json() or {}
    customer_id = data.get("customer_id")
    contact_id = data.get("contact_id")
    status = (data.get("status") or "draft").strip().lower()

    if status not in VALID_INVOICE_STATUS:
        return jsonify({"msg": "Invalid invoice status"}), 400
    if not customer_id:
        return jsonify({"msg": "customer_id is required"}), 400

    _, _, cc_err = _validate_customer_contact(customer_id, contact_id)
    if cc_err:
        return cc_err

    items, items_err = _normalize_items(data.get("items"))
    if items_err:
        return items_err

    issue_date, issue_err = _parse_date(data.get("issue_date"), "issue_date")
    if issue_err:
        return issue_err
    due_date, due_err = _parse_date(data.get("due_date"), "due_date")
    if due_err:
        return due_err

    invoice = Invoice(
        invoice_no=(data.get("invoice_no") or "").strip() or _next_doc_no("INV"),
        status=status,
        customer_id=customer_id,
        contact_id=contact_id,
        quote_id=data.get("quote_id") or None,
        issue_date=issue_date,
        due_date=due_date,
        currency=(data.get("currency") or "TWD").strip().upper() or "TWD",
        note=(data.get("note") or "").strip() or None,
        created_by_id=get_current_user_id(),
    )

    total_err = _apply_totals(invoice, items, data.get("tax_rate", 0))
    if total_err:
        return total_err

    db.session.add(invoice)
    db.session.flush()
    for item in items:
        db.session.add(InvoiceItem(invoice_id=invoice.id, **item))

    db.session.commit()
    invoice = Invoice.query.options(selectinload(Invoice.items)).get(invoice.id)
    return jsonify(invoice.to_dict()), 201


@crm_bp.put("/invoices/<int:invoice_id>")
@role_required(*WRITE_ROLES)
def update_invoice(invoice_id: int):
    invoice = Invoice.query.options(selectinload(Invoice.items)).get_or_404(invoice_id)
    data = request.get_json() or {}

    if "status" in data:
        status = (data.get("status") or "").strip().lower()
        if status not in VALID_INVOICE_STATUS:
            return jsonify({"msg": "Invalid invoice status"}), 400
        invoice.status = status
        if status == "paid":
            invoice.paid_at = datetime.utcnow()

    next_customer_id = data.get("customer_id", invoice.customer_id)
    next_contact_id = data.get("contact_id", invoice.contact_id)
    _, _, cc_err = _validate_customer_contact(next_customer_id, next_contact_id)
    if cc_err:
        return cc_err
    invoice.customer_id = next_customer_id
    invoice.contact_id = next_contact_id

    if "issue_date" in data:
        parsed, err = _parse_date(data.get("issue_date"), "issue_date")
        if err:
            return err
        invoice.issue_date = parsed

    if "due_date" in data:
        parsed, err = _parse_date(data.get("due_date"), "due_date")
        if err:
            return err
        invoice.due_date = parsed

    if "currency" in data:
        invoice.currency = (data.get("currency") or "TWD").strip().upper() or "TWD"
    if "note" in data:
        invoice.note = (data.get("note") or "").strip() or None

    if "items" in data:
        items, items_err = _normalize_items(data.get("items"))
        if items_err:
            return items_err
        invoice.items.clear()
        db.session.flush()
        for item in items:
            db.session.add(InvoiceItem(invoice_id=invoice.id, **item))
        total_err = _apply_totals(invoice, items, data.get("tax_rate", invoice.tax_rate))
    elif "tax_rate" in data:
        items = [item.to_dict() for item in invoice.items]
        total_err = _apply_totals(invoice, items, data.get("tax_rate", invoice.tax_rate))
    else:
        total_err = None

    if total_err:
        return total_err

    db.session.commit()
    invoice = Invoice.query.options(selectinload(Invoice.items)).get(invoice.id)
    return jsonify(invoice.to_dict())


@crm_bp.get("/quotes/<int:quote_id>/pdf")
@role_required(*READ_ROLES)
def quote_pdf(quote_id: int):
    quote = Quote.query.options(selectinload(Quote.items)).get_or_404(quote_id)
    customer = Customer.query.get(quote.customer_id)
    contact = Contact.query.get(quote.contact_id) if quote.contact_id else None

    meta_rows = [
        ["Quote No", quote.quote_no],
        ["Status", quote.status],
        ["Customer", customer.name if customer else ""],
        ["Contact", contact.name if contact else ""],
        ["Email", contact.email if contact else (customer.email if customer else "")],
        ["Phone", contact.phone if contact else (customer.phone if customer else "")],
        ["Issue Date", quote.issue_date.isoformat() if quote.issue_date else ""],
        ["Expiry Date", quote.expiry_date.isoformat() if quote.expiry_date else ""],
        ["Currency", quote.currency],
    ]

    item_rows = [["Description", "Qty", "Unit Price", "Amount"]]
    for item in quote.items:
        item_rows.append(
            [
                item.description,
                f"{item.quantity:.2f}",
                f"{item.unit_price:.2f}",
                f"{item.amount:.2f}",
            ]
        )

    totals_rows = [
        ["Subtotal", f"{quote.subtotal:.2f}"],
        [f"Tax ({quote.tax_rate:.2f}%)", f"{quote.tax_amount:.2f}"],
        ["Total", f"{quote.total_amount:.2f}"],
    ]

    buffer = _build_pdf_document("Quote", meta_rows, item_rows, totals_rows)
    filename = f"quote-{quote.quote_no}.pdf"
    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=False,
        download_name=filename,
    )


@crm_bp.get("/invoices/<int:invoice_id>/pdf")
@role_required(*READ_ROLES)
def invoice_pdf(invoice_id: int):
    invoice = Invoice.query.options(selectinload(Invoice.items)).get_or_404(invoice_id)
    customer = Customer.query.get(invoice.customer_id)
    contact = Contact.query.get(invoice.contact_id) if invoice.contact_id else None

    meta_rows = [
        ["Invoice No", invoice.invoice_no],
        ["Status", invoice.status],
        ["Customer", customer.name if customer else ""],
        ["Contact", contact.name if contact else ""],
        ["Email", contact.email if contact else (customer.email if customer else "")],
        ["Phone", contact.phone if contact else (customer.phone if customer else "")],
        ["Issue Date", invoice.issue_date.isoformat() if invoice.issue_date else ""],
        ["Due Date", invoice.due_date.isoformat() if invoice.due_date else ""],
        ["Currency", invoice.currency],
    ]

    item_rows = [["Description", "Qty", "Unit Price", "Amount"]]
    for item in invoice.items:
        item_rows.append(
            [
                item.description,
                f"{item.quantity:.2f}",
                f"{item.unit_price:.2f}",
                f"{item.amount:.2f}",
            ]
        )

    totals_rows = [
        ["Subtotal", f"{invoice.subtotal:.2f}"],
        [f"Tax ({invoice.tax_rate:.2f}%)", f"{invoice.tax_amount:.2f}"],
        ["Total", f"{invoice.total_amount:.2f}"],
    ]

    buffer = _build_pdf_document("Invoice", meta_rows, item_rows, totals_rows)
    filename = f"invoice-{invoice.invoice_no}.pdf"
    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=False,
        download_name=filename,
    )


@crm_bp.get("/boot")
@jwt_required()
def crm_bootstrap():
    customers = Customer.query.order_by(Customer.updated_at.desc()).limit(50).all()
    contacts = Contact.query.order_by(Contact.updated_at.desc()).limit(100).all()
    quotes = Quote.query.options(selectinload(Quote.items)).order_by(Quote.updated_at.desc()).limit(30).all()
    invoices = Invoice.query.options(selectinload(Invoice.items)).order_by(Invoice.updated_at.desc()).limit(30).all()

    return jsonify(
        {
            "customers": [row.to_dict() for row in customers],
            "contacts": [row.to_dict() for row in contacts],
            "quotes": [row.to_dict() for row in quotes],
            "invoices": [row.to_dict() for row in invoices],
        }
    )
