"""CLI for the workspace migration.

Usage (from the backend directory, with DATABASE_URL set in the environment):

    python scripts/workspace_migration.py inventory
    python scripts/workspace_migration.py backup --out ../backups
    python scripts/workspace_migration.py upgrade --legacy-name 立翔水電行
    python scripts/workspace_migration.py verify
    python scripts/workspace_migration.py downgrade [--force-discard-other-workspaces]

The database URL is read from the environment only and is never printed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="TaskGo workspace migration")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("inventory")
    backup_parser = sub.add_parser("backup")
    backup_parser.add_argument("--out", required=True)
    upgrade_parser = sub.add_parser("upgrade")
    upgrade_parser.add_argument("--legacy-name", default="立翔水電行")
    upgrade_parser.add_argument("--adopt-orphans", action="store_true")
    sub.add_parser("verify")
    downgrade_parser = sub.add_parser("downgrade")
    downgrade_parser.add_argument("--force-discard-other-workspaces", action="store_true")
    args = parser.parse_args(argv)

    # Never let app startup run DDL on its own; this script is the only writer.
    os.environ["INIT_DB_ON_STARTUP"] = "0"
    from app import app
    import workspace_migration as migration

    with app.app_context():
        if args.command == "inventory":
            result = migration.inventory()
        elif args.command == "backup":
            result = {"backup_file": migration.backup(args.out)}
        elif args.command == "upgrade":
            result = migration.upgrade(args.legacy_name, adopt_orphans=args.adopt_orphans)
        elif args.command == "verify":
            result = migration.verify()
        else:
            try:
                result = migration.downgrade(force_discard_other_workspaces=args.force_discard_other_workspaces)
            except migration.MigrationError as exc:
                print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
                return 2
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    if args.command == "verify" and not result.get("ok"):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
