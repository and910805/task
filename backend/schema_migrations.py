from sqlalchemy import inspect, text

from extensions import db


def ensure_invoice_item_note_column() -> None:
    """Add invoice item notes and recover notes lost by older quote conversions."""
    inspector = inspect(db.engine)
    table_names = set(inspector.get_table_names())
    if not {"invoice", "invoice_item", "quote_item"}.issubset(table_names):
        return
    if db.engine.dialect.name not in {"sqlite", "postgresql"}:
        return

    columns = {column["name"] for column in inspector.get_columns("invoice_item")}
    if "note" not in columns:
        db.session.execute(text("ALTER TABLE invoice_item ADD COLUMN note TEXT"))
        db.session.commit()

    invoice_rows = db.session.execute(
        text(
            """
            SELECT ii.id AS invoice_item_id,
                   ii.invoice_id AS invoice_id,
                   ii.description AS description,
                   ii.sort_order AS sort_order,
                   ii.note AS note,
                   i.quote_id AS quote_id
            FROM invoice_item ii
            JOIN invoice i ON i.id = ii.invoice_id
            WHERE i.quote_id IS NOT NULL
            ORDER BY ii.invoice_id, ii.sort_order, ii.id
            """
        )
    ).mappings().all()
    quote_rows = db.session.execute(
        text(
            """
            SELECT qi.id AS quote_item_id,
                   qi.quote_id AS quote_id,
                   qi.description AS description,
                   qi.sort_order AS sort_order,
                   qi.note AS note
            FROM quote_item qi
            ORDER BY qi.quote_id, qi.sort_order, qi.id
            """
        )
    ).mappings().all()

    quote_items_by_quote: dict[int, list[dict]] = {}
    for row in quote_rows:
        quote_items_by_quote.setdefault(int(row["quote_id"]), []).append(row)

    invoice_positions: dict[int, int] = {}
    repaired = 0
    for invoice_item in invoice_rows:
        invoice_id = int(invoice_item["invoice_id"])
        position = invoice_positions.get(invoice_id, 0)
        invoice_positions[invoice_id] = position + 1
        if str(invoice_item["note"] or "").strip():
            continue

        quote_items = quote_items_by_quote.get(int(invoice_item["quote_id"]), [])
        normalized_description = str(invoice_item["description"] or "").strip().casefold()
        candidates = [
            row
            for row in quote_items
            if str(row["description"] or "").strip().casefold() == normalized_description
            and str(row["note"] or "").strip()
        ]
        source = candidates[0] if len(candidates) == 1 else None
        if source is None and position < len(quote_items):
            positional = quote_items[position]
            if (
                str(positional["description"] or "").strip().casefold() == normalized_description
                and str(positional["note"] or "").strip()
            ):
                source = positional
        if source is None:
            continue

        db.session.execute(
            text("UPDATE invoice_item SET note = :note WHERE id = :item_id"),
            {"note": source["note"], "item_id": invoice_item["invoice_item_id"]},
        )
        repaired += 1

    if repaired:
        db.session.commit()
