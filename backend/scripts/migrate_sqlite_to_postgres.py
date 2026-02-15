from __future__ import annotations

import argparse
import os
from datetime import datetime, date

from sqlalchemy import Date, DateTime, MetaData, Table, create_engine, func, select, text

from extensions import db
import models  # noqa: F401  # register SQLAlchemy models


def _normalize_database_url(db_url: str | None) -> str | None:
    if not db_url:
        return None
    if db_url.startswith("postgres://"):
        return db_url.replace("postgres://", "postgresql+psycopg://", 1)
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    if db_url.startswith("postgresql+psycopg2://"):
        return db_url.replace("postgresql+psycopg2://", "postgresql+psycopg://", 1)
    return db_url


TABLE_ORDER = [
    "user",
    "role_label",
    "site_setting",
    "site_location",
    "customer",
    "contact",
    "quote",
    "quote_item",
    "invoice",
    "invoice_item",
    "task",
    "task_assignee",
    "task_update",
    "attachment",
]


def _coerce_value(col, value):
    if value is None:
        return None
    if isinstance(col.type, DateTime):
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            candidate = value.replace("Z", "+00:00")
            try:
                return datetime.fromisoformat(candidate)
            except ValueError:
                return value
    if isinstance(col.type, Date):
        if isinstance(value, date):
            return value
        if isinstance(value, str):
            try:
                return date.fromisoformat(value[:10])
            except ValueError:
                return value
    return value


def _copy_table(source_conn, target_conn, source_table: Table, target_table: Table):
    rows = source_conn.execute(select(source_table)).mappings().all()
    if not rows:
        return 0

    payload = []
    for row in rows:
        item = {}
        for col in target_table.columns:
            if col.name not in row:
                continue
            item[col.name] = _coerce_value(col, row[col.name])
        payload.append(item)

    target_conn.execute(target_table.insert(), payload)
    return len(payload)


def _reset_sequence(target_conn, table_name: str, target_table: Table):
    if "id" not in target_table.columns:
        return
    result = target_conn.execute(select(func.max(target_table.c.id)))
    max_id = result.scalar()
    if max_id is None:
        return
    target_conn.execute(
        text("SELECT setval(pg_get_serial_sequence(:table, 'id'), :value)"),
        {"table": table_name, "value": int(max_id)},
    )


def main():
    parser = argparse.ArgumentParser(description="Migrate task SQLite data to PostgreSQL.")
    parser.add_argument(
        "--source",
        default=os.path.join(os.path.dirname(__file__), "..", "uploads", "task_manager.db"),
        help="Path to SQLite database file.",
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("DATABASE_URL"),
        help="Target PostgreSQL DATABASE_URL (defaults to env DATABASE_URL).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Truncate target tables before inserting.",
    )
    args = parser.parse_args()

    source_path = os.path.abspath(args.source)
    if not os.path.exists(source_path):
        raise SystemExit(f"SQLite file not found: {source_path}")

    target_url = _normalize_database_url(args.target)
    if not target_url:
        raise SystemExit("Target DATABASE_URL is required (use --target or env DATABASE_URL).")
    if not (
        target_url.startswith("postgresql://")
        or target_url.startswith("postgresql+psycopg://")
    ):
        raise SystemExit("Target DATABASE_URL must be PostgreSQL.")

    source_engine = create_engine(f"sqlite:///{source_path}")
    target_engine = create_engine(target_url)

    db.Model.metadata.create_all(bind=target_engine)

    source_meta = MetaData()
    source_meta.reflect(bind=source_engine)
    available_tables = set(source_meta.tables.keys())
    ordered_tables = [name for name in TABLE_ORDER if name in available_tables]

    with source_engine.connect() as source_conn, target_engine.begin() as target_conn:
        for table_name in ordered_tables:
            target_table = db.Model.metadata.tables.get(table_name)
            if target_table is None:
                continue

            existing = target_conn.execute(select(func.count()).select_from(target_table))
            existing_count = existing.scalar() or 0
            if existing_count > 0 and not args.force:
                print(f"Skip {table_name}: target already has data ({existing_count} rows).")
                continue

            if args.force:
                target_conn.execute(text(f'TRUNCATE TABLE "{table_name}" RESTART IDENTITY CASCADE'))

            copied = _copy_table(source_conn, target_conn, source_meta.tables[table_name], target_table)
            print(f"Copied {copied} rows into {table_name}.")

            _reset_sequence(target_conn, table_name, target_table)

    print("Migration completed.")


if __name__ == "__main__":
    main()
