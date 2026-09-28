"""Reversible single-tenant -> multi-tenant (workspace) migration.

Commands (see ``scripts/workspace_migration.py`` or ``flask workspace-migrate``):

* ``inventory`` - read-only counts of every TaskGo table
* ``backup``    - JSONL.gz export of every TaskGo table (other apps' tables in
                  the same database are never read or touched)
* ``upgrade``   - additive and idempotent: new workspace tables, nullable
                  ``workspace_id`` columns, the legacy company workspace,
                  backfill, memberships from ``user.role``, copied settings
* ``verify``    - read-only consistency checks
* ``downgrade`` - removes what ``upgrade`` added; refuses when other companies
                  have data unless explicitly forced

Existing columns and rows are never deleted or overwritten by ``upgrade``;
``site_setting`` and ``role_label`` are copied, not moved.
"""

from __future__ import annotations

import gzip
import json
import os
import re
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import MetaData, Table, UniqueConstraint, inspect, text
from sqlalchemy.schema import CreateTable

from extensions import db

MIGRATION_KEY = "schema.workspace_migration"
LEGACY_SLUG = "legacy"

TENANT_TABLES = (
    "task",
    "site_location",
    "audit_log",
    "customer",
    "contact",
    "website_booking",
    "quote",
    "contract",
    "invoice",
    "service_catalog_item",
    "material_item",
    "material_purchase_batch",
    "material_stock_txn",
)
NEW_TABLES = ("workspace", "workspace_member", "workspace_invitation", "workspace_setting", "device_token")
COPIED_SITE_SETTINGS = ("branding_name", "branding_logo_path", "task_update_note_templates")
LEGACY_ROLE_LABELS = {"worker": "工人", "site_supervisor": "現場主管", "hq_staff": "總部人員", "admin": "管理員"}
VALID_ROLES = {"admin", "site_supervisor", "hq_staff", "worker"}
SCOPED_UNIQUES = {
    "site_location": (("name",), "uq_site_location_workspace_name"),
    "customer": (("name",), "uq_customer_workspace_name"),
    "quote": (("quote_no",), "uq_quote_workspace_quote_no"),
    "contract": (("contract_no",), "uq_contract_workspace_contract_no"),
    "invoice": (("invoice_no",), "uq_invoice_workspace_invoice_no"),
    "service_catalog_item": (("name",), "uq_service_catalog_workspace_name"),
    "material_item": (("name", "spec"), "uq_material_item_workspace_name_spec"),
}


class MigrationError(RuntimeError):
    pass


def _q(name: str) -> str:
    return db.engine.dialect.identifier_preparer.quote(name)


def _tables() -> set[str]:
    return set(inspect(db.engine).get_table_names())


def _columns(table: str) -> set[str]:
    return {column["name"] for column in inspect(db.engine).get_columns(table)}


def system_tables() -> list[str]:
    """TaskGo's own tables (from the models), never another app's tables."""
    import models  # noqa: F401  - registers every model on the metadata

    existing = _tables()
    return [table.name for table in db.metadata.sorted_tables if table.name in existing]


def _count(conn, table: str, where: str = "") -> int:
    return int(conn.execute(text(f"SELECT COUNT(*) FROM {_q(table)} {where}")).scalar() or 0)


def inventory() -> dict:
    result: dict = {"dialect": db.engine.dialect.name, "tables": {}, "roles": {}, "migrated": False}
    with db.engine.connect() as conn:
        for table in system_tables():
            result["tables"][table] = _count(conn, table)
        if "user" in _tables():
            for role, count in conn.execute(text(f"SELECT role, COUNT(*) FROM {_q('user')} GROUP BY role")):
                result["roles"][str(role)] = int(count)
        if "workspace" in _tables():
            result["migrated"] = True
            result["workspaces"] = [
                dict(row._mapping)
                for row in conn.execute(text("SELECT id, name, is_legacy, plan, status FROM workspace ORDER BY id"))
            ]
    return result


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    return str(value)


def backup(out_dir: str) -> str:
    """Write every TaskGo table as JSONL.gz; returns the file path."""
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(out_dir, f"taskgo_pre_workspace_{stamp}.jsonl.gz")
    with db.engine.connect() as conn, gzip.open(path, "wt", encoding="utf-8") as handle:
        for table in system_tables():
            for row in conn.execute(text(f"SELECT * FROM {_q(table)}")):
                handle.write(json.dumps({"table": table, "row": dict(row._mapping)}, default=_json_default, ensure_ascii=False))
                handle.write("\n")
    return path


def _create_new_tables(conn) -> None:
    import models

    tables = [
        models.Workspace.__table__,
        models.WorkspaceMember.__table__,
        models.WorkspaceInvitation.__table__,
        models.WorkspaceSetting.__table__,
        models.DeviceToken.__table__,
    ]
    db.metadata.create_all(bind=conn, tables=tables, checkfirst=True)


def _add_workspace_columns(conn) -> list[str]:
    added = []
    existing_tables = set(inspect(conn).get_table_names())
    for table in TENANT_TABLES:
        if table not in existing_tables:
            continue
        columns = {column["name"] for column in inspect(conn).get_columns(table)}
        if "workspace_id" not in columns:
            conn.execute(text(f"ALTER TABLE {_q(table)} ADD COLUMN workspace_id INTEGER REFERENCES workspace(id)"))
            added.append(table)
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS {_q('ix_' + table + '_workspace_id')} ON {_q(table)} (workspace_id)"))
    return added


def _unique_definitions(conn, table: str) -> list[dict]:
    inspector = inspect(conn)
    definitions = []
    seen = set()
    for item in inspector.get_unique_constraints(table):
        columns = tuple(item.get("column_names") or ())
        name = item.get("name")
        if columns:
            definitions.append({"name": name, "columns": columns, "kind": "constraint"})
            if name:
                seen.add(name)
    for item in inspector.get_indexes(table):
        name = item.get("name")
        columns = tuple(item.get("column_names") or ())
        if item.get("unique") and columns and name not in seen:
            definitions.append({"name": name, "columns": columns, "kind": "index"})
    return definitions


@contextmanager
def _migration_transaction():
    """Run migrations atomically, disabling SQLite FK actions only on this connection."""
    conn = db.engine.connect()
    sqlite = db.engine.dialect.name == "sqlite"
    transaction = None
    try:
        if sqlite:
            conn = conn.execution_options(isolation_level="AUTOCOMMIT")
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            if conn.exec_driver_sql("PRAGMA foreign_keys").scalar() != 0:
                raise MigrationError("Could not disable SQLite foreign keys before migration transaction")
            conn.commit()
            conn = conn.execution_options(isolation_level="SERIALIZABLE")
        transaction = conn.begin()
        if sqlite:
            conn.exec_driver_sql("BEGIN IMMEDIATE")
        yield conn
        if sqlite:
            violations = conn.exec_driver_sql("PRAGMA foreign_key_check").all()
            if violations:
                raise MigrationError(f"SQLite foreign key check failed: {violations[:5]}")
        transaction.commit()
    except Exception:
        if transaction is not None and transaction.is_active:
            transaction.rollback()
        raise
    finally:
        if sqlite:
            try:
                conn = conn.execution_options(isolation_level="AUTOCOMMIT")
                conn.exec_driver_sql("PRAGMA foreign_keys=ON")
                if conn.exec_driver_sql("PRAGMA foreign_keys").scalar() != 1:
                    raise MigrationError("Could not restore SQLite foreign_keys=ON")
                conn.commit()
            finally:
                conn.close()
        else:
            conn.close()


def _sqlite_rebuild_unique_table(conn, table: str, columns: tuple[str, ...], name: str, *, per_workspace: bool) -> None:
    temp_name = f"{table}__workspace_rebuild"
    if temp_name in set(inspect(conn).get_table_names()):
        raise MigrationError(f"Refusing to overwrite existing SQLite table {temp_name}")
    source_sql = conn.execute(
        text("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = :table"), {"table": table}
    ).scalar()
    if not source_sql:
        raise MigrationError(f"Cannot reflect SQLite table definition for {table}")
    if re.search(r"\bWITHOUT\s+ROWID\b|\bSTRICT\s*\)?\s*$", source_sql, re.IGNORECASE):
        raise MigrationError(f"Refusing to rebuild {table}: unsupported SQLite table option")

    metadata = MetaData()
    source = Table(table, metadata, autoload_with=conn)
    rebuilt = source.to_metadata(metadata, name=temp_name)
    scoped_columns = ("workspace_id", *columns)
    for constraint in list(rebuilt.constraints):
        if isinstance(constraint, UniqueConstraint) and tuple(column.name for column in constraint.columns) in (
            columns,
            scoped_columns,
        ):
            rebuilt.constraints.remove(constraint)
    rebuilt.append_constraint(UniqueConstraint(*(scoped_columns if per_workspace else columns), name=name))

    indexes = conn.execute(
        text("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = :table AND sql IS NOT NULL"),
        {"table": table},
    ).all()
    triggers = conn.execute(
        text("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = :table AND sql IS NOT NULL"),
        {"table": table},
    ).scalars().all()
    unique_targets = {columns, scoped_columns}
    remove_index_names = {
        item["name"] for item in _unique_definitions(conn, table) if item["columns"] in unique_targets
    }
    old_sequence = None
    if "AUTOINCREMENT" in source_sql.upper():
        rebuilt.dialect_options["sqlite"]["autoincrement"] = True
        if "sqlite_sequence" in set(inspect(conn).get_table_names()):
            old_sequence = conn.execute(
                text("SELECT seq FROM sqlite_sequence WHERE name = :table"), {"table": table}
            ).scalar()
    conn.execute(CreateTable(rebuilt))
    new_columns = [column.name for column in rebuilt.columns if column.computed is None]
    quoted = ", ".join(_q(column) for column in new_columns)
    conn.execute(text(f"INSERT INTO {_q(temp_name)} ({quoted}) SELECT {quoted} FROM {_q(table)}"))
    before = conn.execute(text(f"SELECT COUNT(*) FROM {_q(table)}")).scalar()
    conn.execute(text(f"DROP TABLE {_q(table)}"))
    conn.execute(text(f"ALTER TABLE {_q(temp_name)} RENAME TO {_q(table)}"))
    for index_name, index_sql in indexes:
        if index_name not in remove_index_names:
            conn.exec_driver_sql(index_sql)
    for trigger_sql in triggers:
        conn.exec_driver_sql(trigger_sql)
    after = conn.execute(text(f"SELECT COUNT(*) FROM {_q(table)}")).scalar()
    if before != after:
        raise MigrationError(f"SQLite row count changed while rebuilding {table}: {before} -> {after}")
    if old_sequence is not None:
        current_sequence = conn.execute(
            text("SELECT seq FROM sqlite_sequence WHERE name = :table"), {"table": table}
        ).scalar()
        if current_sequence is None:
            conn.execute(text("INSERT INTO sqlite_sequence (name, seq) VALUES (:table, :seq)"), {"table": table, "seq": old_sequence})
        elif current_sequence < old_sequence:
            conn.execute(text("UPDATE sqlite_sequence SET seq = :seq WHERE name = :table"), {"table": table, "seq": old_sequence})


def _set_tenant_uniqueness(conn, *, per_workspace: bool) -> None:
    existing_tables = set(inspect(conn).get_table_names())
    for table, (columns, index_name) in SCOPED_UNIQUES.items():
        if table not in existing_tables:
            continue
        definitions = _unique_definitions(conn, table)
        scoped = ("workspace_id", *columns)
        global_matches = [item for item in definitions if item["columns"] == columns]
        scoped_matches = [item for item in definitions if item["columns"] == scoped]
        if db.engine.dialect.name == "sqlite":
            needs_rebuild = bool(global_matches) if per_workspace else bool(scoped_matches)
            if needs_rebuild or not (scoped_matches if per_workspace else global_matches):
                _sqlite_rebuild_unique_table(conn, table, columns, index_name, per_workspace=per_workspace)
            continue

        for item in global_matches if per_workspace else scoped_matches:
            if not item["name"]:
                raise MigrationError(f"Cannot safely identify unique object on {table}: {item}")
            if item["kind"] == "constraint":
                conn.execute(text(f"ALTER TABLE {_q(table)} DROP CONSTRAINT {_q(item['name'])}"))
            else:
                conn.execute(text(f"DROP INDEX IF EXISTS {_q(item['name'])}"))
        if per_workspace:
            conn.execute(
                text(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS {_q(index_name)} ON {_q(table)} "
                    f"({', '.join(_q(column) for column in scoped)})"
                )
            )
        elif scoped_matches:
            duplicate_filter = " AND ".join(f"{_q(column)} IS NOT NULL" for column in columns)
            duplicates = conn.execute(
                text(
                    f"SELECT 1 FROM {_q(table)} WHERE {duplicate_filter} GROUP BY "
                    f"{', '.join(_q(column) for column in columns)} HAVING COUNT(*) > 1 LIMIT 1"
                )
            ).first()
            if duplicates:
                raise MigrationError(f"Cannot restore global uniqueness on {table}; duplicate values remain")
            conn.execute(
                text(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS {_q(index_name + '_global')} ON {_q(table)} "
                    f"({', '.join(_q(column) for column in columns)})"
                )
            )

    for table, (columns, _) in SCOPED_UNIQUES.items():
        if table not in set(inspect(conn).get_table_names()):
            continue
        actual = [item["columns"] for item in _unique_definitions(conn, table)]
        required = ("workspace_id", *columns) if per_workspace else columns
        forbidden = columns if per_workspace else ("workspace_id", *columns)
        if required not in actual or forbidden in actual:
            raise MigrationError(f"Unique constraint verification failed for {table}: {actual}")


def _assert_global_unique_compatible(conn, legacy_id: int) -> None:
    tables = set(inspect(conn).get_table_names())
    for table, (columns, _) in SCOPED_UNIQUES.items():
        if table not in tables:
            continue
        non_null = " AND ".join(f"{_q(column)} IS NOT NULL" for column in columns)
        duplicates = conn.execute(
            text(
                f"SELECT 1 FROM {_q(table)} WHERE (workspace_id IS NULL OR workspace_id = :legacy) "
                f"AND {non_null} GROUP BY {', '.join(_q(column) for column in columns)} "
                "HAVING COUNT(*) > 1 LIMIT 1"
            ),
            {"legacy": legacy_id},
        ).first()
        if duplicates:
            raise MigrationError(f"Cannot downgrade: {table} has values incompatible with its former global unique constraint")


def _state(conn, legacy_id: int) -> dict | None:
    raw = conn.execute(
        text("SELECT value FROM workspace_setting WHERE workspace_id = :w AND key = :k"),
        {"w": legacy_id, "k": MIGRATION_KEY},
    ).scalar()
    return json.loads(raw) if raw else None


def _set_setting(conn, workspace_id: int, key: str, value: str) -> None:
    exists = conn.execute(
        text("SELECT 1 FROM workspace_setting WHERE workspace_id = :w AND key = :k"),
        {"w": workspace_id, "k": key},
    ).scalar()
    if not exists:
        conn.execute(
            text("INSERT INTO workspace_setting (workspace_id, key, value, updated_at) VALUES (:w, :k, :v, :t)"),
            {"w": workspace_id, "k": key, "v": value, "t": datetime.utcnow()},
        )


def ensure_schema() -> None:
    """DDL only (new tables, nullable columns); used by dev startup.

    Assigning existing data to a company is a deliberate step: ``upgrade``.
    """
    with db.engine.begin() as conn:
        _create_new_tables(conn)
        _add_workspace_columns(conn)


def needs_data_migration() -> bool:
    with db.engine.connect() as conn:
        if "user" not in _tables() or "workspace" not in _tables():
            return False
        users = _count(conn, "user")
        workspaces = _count(conn, "workspace")
    return users > 0 and workspaces == 0


def upgrade(legacy_name: str = "立翔水電行", *, adopt_orphans: bool = False) -> dict:
    """Apply the migration in one transaction. Safe to run repeatedly."""
    legacy_name = (legacy_name or "").strip() or "立翔水電行"
    report: dict = {"columns_added": [], "backfilled": {}, "memberships_created": 0, "settings_copied": []}
    now = datetime.utcnow()
    with _migration_transaction() as conn:
        _create_new_tables(conn)
        report["columns_added"] = _add_workspace_columns(conn)
        _set_tenant_uniqueness(conn, per_workspace=True)

        legacy_id = conn.execute(text("SELECT id FROM workspace WHERE is_legacy = :t ORDER BY id LIMIT 1"), {"t": True}).scalar()
        first_run = legacy_id is None
        if first_run and not _count(conn, "user"):
            # Fresh install: nothing to assign, no legacy company to create.
            report["skipped_empty"] = True
            report["legacy_workspace_id"] = None
            report["first_run"] = True
            return report
        if first_run:
            owner_id = conn.execute(
                text(f"SELECT id FROM {_q('user')} WHERE role = 'admin' ORDER BY id LIMIT 1")
            ).scalar()
            conn.execute(
                text(
                    "INSERT INTO workspace (name, slug, industry, owner_user_id, plan, status, is_legacy, created_at, updated_at) "
                    "VALUES (:name, :slug, 'plumbing_electrical', :owner, 'legacy', 'active', :t, :now, :now)"
                ),
                {"name": legacy_name, "slug": LEGACY_SLUG, "owner": owner_id, "t": True, "now": now},
            )
            legacy_id = conn.execute(text("SELECT id FROM workspace WHERE slug = :s"), {"s": LEGACY_SLUG}).scalar()
        report["legacy_workspace_id"] = int(legacy_id)
        report["first_run"] = first_run

        for table in TENANT_TABLES:
            if table in set(inspect(conn).get_table_names()):
                updated = conn.execute(
                    text(f"UPDATE {_q(table)} SET workspace_id = :w WHERE workspace_id IS NULL"), {"w": legacy_id}
                ).rowcount
                if updated:
                    report["backfilled"][table] = int(updated)

        state = _state(conn, legacy_id) or {}
        if first_run or adopt_orphans:
            # Existing staff join the legacy company with their current role.
            # Later runs only adopt accounts without any membership when asked
            # (e.g. accounts created by old code after a code rollback).
            where = "" if first_run else "WHERE NOT EXISTS (SELECT 1 FROM workspace_member m WHERE m.user_id = u.id)"
            users = conn.execute(text(f"SELECT u.id, u.role FROM {_q('user')} u {where}")).all()
            for user_id, role in users:
                exists = conn.execute(
                    text("SELECT 1 FROM workspace_member WHERE workspace_id = :w AND user_id = :u"),
                    {"w": legacy_id, "u": user_id},
                ).scalar()
                if exists:
                    continue
                conn.execute(
                    text(
                        "INSERT INTO workspace_member (workspace_id, user_id, role, status, joined_at) "
                        "VALUES (:w, :u, :r, 'active', :now)"
                    ),
                    {"w": legacy_id, "u": user_id, "r": role if role in VALID_ROLES else "worker", "now": now},
                )
                report["memberships_created"] += 1

        tables = set(inspect(conn).get_table_names())
        if "site_setting" in tables:
            for key in COPIED_SITE_SETTINGS:
                value = conn.execute(text("SELECT value FROM site_setting WHERE key = :k"), {"k": key}).scalar()
                if value:
                    _set_setting(conn, legacy_id, key, value)
                    report["settings_copied"].append(key)
        labels = dict(LEGACY_ROLE_LABELS)
        if "role_label" in tables:
            for role, label in conn.execute(text("SELECT role, label FROM role_label")):
                labels[str(role)] = str(label)
        _set_setting(conn, legacy_id, "role_labels", json.dumps(labels, ensure_ascii=False))

        if not state:
            user_watermark = conn.execute(text(f"SELECT MAX(id) FROM {_q('user')}")).scalar()
            _set_setting(
                conn,
                legacy_id,
                MIGRATION_KEY,
                json.dumps({"version": 1, "migrated_at": now.isoformat(), "user_watermark": user_watermark}),
            )
    return report


def verify() -> dict:
    problems: list[str] = []
    result: dict = {"null_workspace_ids": {}, "counts": {}, "orphan_accounts": 0, "ok": False}
    tables = _tables()
    for table in NEW_TABLES:
        if table not in tables:
            problems.append(f"missing table {table}")
    with db.engine.connect() as conn:
        for table, (columns, _) in SCOPED_UNIQUES.items():
            if table not in tables:
                continue
            definitions = {item["columns"] for item in _unique_definitions(conn, table)}
            if columns in definitions:
                problems.append(f"{table}: legacy global uniqueness still present")
            if ("workspace_id", *columns) not in definitions:
                problems.append(f"{table}: workspace-scoped uniqueness missing")
        for table in TENANT_TABLES:
            if table not in tables:
                continue
            if "workspace_id" not in _columns(table):
                problems.append(f"{table}.workspace_id missing")
                continue
            nulls = _count(conn, table, "WHERE workspace_id IS NULL")
            result["counts"][table] = _count(conn, table)
            if nulls:
                result["null_workspace_ids"][table] = nulls
                problems.append(f"{table}: {nulls} rows without workspace")
        if "workspace" in tables:
            legacy = _count(conn, "workspace", "WHERE is_legacy = TRUE" if db.engine.dialect.name == "postgresql" else "WHERE is_legacy = 1")
            has_accounts = _count(conn, "user") > 0 if "user" in tables else False
            if legacy > 1 or (legacy == 0 and has_accounts and not _count(conn, "workspace")):
                problems.append(f"expected one legacy workspace, found {legacy}")
            result["orphan_accounts"] = int(
                conn.execute(
                    text(
                        f"SELECT COUNT(*) FROM {_q('user')} u WHERE NOT EXISTS "
                        "(SELECT 1 FROM workspace_member m WHERE m.user_id = u.id)"
                    )
                ).scalar()
                or 0
            )
    result["problems"] = problems
    result["ok"] = not problems
    return result


def downgrade(*, force_discard_other_workspaces: bool = False) -> dict:
    """Return to single-tenant. Legacy data and roles are preserved."""
    tables = _tables()
    if "workspace" not in tables:
        return {"skipped": "not migrated"}
    report: dict = {}
    with _migration_transaction() as conn:
        legacy_id = conn.execute(text("SELECT id FROM workspace WHERE is_legacy = :t ORDER BY id LIMIT 1"), {"t": True}).scalar()
        if legacy_id is None:
            if _count(conn, "workspace"):
                raise MigrationError("legacy workspace not found; restore from backup instead")
            legacy_id = -1  # schema only, no company data yet

        foreign_rows = {}
        for table in TENANT_TABLES:
            if table in tables and "workspace_id" in {c["name"] for c in inspect(conn).get_columns(table)}:
                count = _count(conn, table, f"WHERE workspace_id IS NOT NULL AND workspace_id <> {int(legacy_id)}")
                if count:
                    foreign_rows[table] = count
        outsiders = [
            int(row[0])
            for row in conn.execute(
                text(
                    f"SELECT u.id FROM {_q('user')} u WHERE NOT EXISTS (SELECT 1 FROM workspace_member m "
                    "WHERE m.user_id = u.id AND m.workspace_id = :w AND m.status = 'active')"
                ),
                {"w": legacy_id},
            )
        ]
        report["other_workspace_rows"] = foreign_rows
        report["accounts_outside_legacy"] = len(outsiders)
        if (foreign_rows or outsiders) and not force_discard_other_workspaces:
            # Old code has no company boundary: every account would become
            # legacy staff and every task legacy data.
            raise MigrationError(
                "other companies have data or accounts; rerun with --force-discard-other-workspaces "
                f"to delete them (rows={foreign_rows}, accounts={len(outsiders)})"
            )

        if foreign_rows:
            foreign_tasks = f"SELECT id FROM task WHERE workspace_id <> {int(legacy_id)}"
            for child, column in (
                ("task_assignee", "task_id"),
                ("task_update", "task_id"),
                ("attachment", "task_id"),
                ("task_material_usage", "task_id"),
                ("material_stock_txn", "task_id"),
            ):
                if child in tables:
                    conn.execute(text(f"DELETE FROM {_q(child)} WHERE {column} IN ({foreign_tasks})"))
            for table in TENANT_TABLES:
                if table in foreign_rows:
                    conn.execute(text(f"DELETE FROM {_q(table)} WHERE workspace_id <> {int(legacy_id)}"))
        for user_id in outsiders:
            for table, column, action in (
                ("task", "assigned_to_id", "null"),
                ("task", "assigned_by_id", "null"),
                ("task_assignee", "user_id", "delete"),
                ("task_update", "user_id", "null"),
                ("attachment", "uploaded_by_id", "null"),
                ("workspace_member", "user_id", "delete"),
                ("workspace_invitation", "invited_by_id", "null"),
                ("device_token", "user_id", "delete"),
            ):
                if table not in tables:
                    continue
                if action == "delete":
                    conn.execute(text(f"DELETE FROM {_q(table)} WHERE {column} = :u"), {"u": user_id})
                else:
                    conn.execute(text(f"UPDATE {_q(table)} SET {column} = NULL WHERE {column} = :u"), {"u": user_id})
            conn.execute(text("UPDATE workspace SET owner_user_id = NULL WHERE owner_user_id = :u"), {"u": user_id})
            conn.execute(text(f"DELETE FROM {_q('user')} WHERE id = :u"), {"u": user_id})

        # Role changes made after the migration survive the rollback.
        synced = conn.execute(
            text(
                f"UPDATE {_q('user')} SET role = (SELECT m.role FROM workspace_member m "
                f"WHERE m.user_id = {_q('user')}.id AND m.workspace_id = :w) "
                "WHERE EXISTS (SELECT 1 FROM workspace_member m WHERE m.user_id = "
                f"{_q('user')}.id AND m.workspace_id = :w)"
            ),
            {"w": legacy_id},
        ).rowcount
        report["roles_synced"] = int(synced or 0)

        dialect = db.engine.dialect.name
        _assert_global_unique_compatible(conn, int(legacy_id))
        _set_tenant_uniqueness(conn, per_workspace=False)

        for table in TENANT_TABLES:
            if table not in tables:
                continue
            conn.execute(text(f"DROP INDEX IF EXISTS {_q('ix_' + table + '_workspace_id')}"))
            if dialect == "postgresql":
                conn.execute(text(f"ALTER TABLE {_q(table)} DROP COLUMN IF EXISTS workspace_id"))
            else:
                # SQLite cannot drop a column with a REFERENCES clause; old code
                # ignores this nullable column, so it is cleared instead.
                conn.execute(text(f"UPDATE {_q(table)} SET workspace_id = NULL"))
        for table in reversed(NEW_TABLES):
            if table in tables:
                conn.execute(text(f"DROP TABLE {_q(table)}"))
    report["ok"] = True
    return report
