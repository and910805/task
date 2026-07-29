"""Read-only PostgreSQL transport and privilege audit.

The command reads DATABASE_URL from the environment and deliberately reports
only server/security metadata. It never prints the connection URL or row data.
"""

from __future__ import annotations

import os

from sqlalchemy import create_engine, text


def _database_url() -> str:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        raise SystemExit("DATABASE_URL is required")
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


def main() -> None:
    sslmode = (os.environ.get("DB_AUDIT_SSLMODE") or "require").strip().lower()
    allowed_ssl_modes = {"require", "verify-ca", "verify-full", "disable"}
    if sslmode not in allowed_ssl_modes:
        raise SystemExit("DB_AUDIT_SSLMODE must be require, verify-ca, verify-full, or disable")

    engine = create_engine(
        _database_url(),
        pool_pre_ping=True,
        connect_args={"connect_timeout": 10, "sslmode": sslmode},
    )
    statement = text(
        """
        SELECT
            current_setting('server_version_num')::integer,
            COALESCE(
                (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()),
                FALSE
            ),
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
            has_database_privilege(current_user, current_database(), 'CREATE'),
            has_schema_privilege(current_user, 'public', 'CREATE'),
            (
                SELECT count(*)
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            )
        """
    )

    try:
        with engine.connect() as connection:
            connection.execute(text("SET TRANSACTION READ ONLY"))
            row = connection.execute(statement).one()
            print("requested_sslmode", sslmode)
            print("server_version_num", int(row[0]))
            print("tls_active", bool(row[1]))
            print("db_role_superuser", bool(row[2]))
            print("database_create_privilege", bool(row[3]))
            print("public_schema_create_privilege", bool(row[4]))
            print("public_table_count", int(row[5]))
            connection.rollback()
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
