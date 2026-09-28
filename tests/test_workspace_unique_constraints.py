"""Workspace-scoped uniqueness and legacy-schema migration coverage."""

import os
import sys
import tempfile
import unittest
import uuid
from datetime import date
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.exc import IntegrityError
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


class WorkspaceUniqueConstraintTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        configured_pg_url = os.environ.get("TASKGO_TEST_DATABASE_URL", "").strip()
        self.pg_schema = None
        self.admin_engine = None
        if configured_pg_url:
            base_url = make_url(configured_pg_url)
            if (
                base_url.get_backend_name() != "postgresql"
                or base_url.host not in {"localhost", "127.0.0.1", "::1"}
                or base_url.port != 56790
                or base_url.database != "taskgo_review"
                or base_url.username != "postgres"
            ):
                raise RuntimeError(
                    "TASKGO_TEST_DATABASE_URL must target postgres@localhost:56790/taskgo_review"
                )
            base_url = base_url.set(host="127.0.0.1").update_query_dict(
                {"connect_timeout": "5", "sslmode": "disable"}
            )
            self.pg_schema = f"taskgo_unique_test_{uuid.uuid4().hex}"
            self.admin_engine = create_engine(base_url)
            with self.admin_engine.begin() as conn:
                conn.execute(text(f'CREATE SCHEMA "{self.pg_schema}"'))
            isolated_url = base_url.update_query_dict({"options": f"-csearch_path={self.pg_schema}"})
            database_url = isolated_url.render_as_string(hide_password=False)
        else:
            database_url = f"sqlite:///{Path(self.temp_dir.name) / 'unique.db'}"
        env = {
            "DATABASE_URL": database_url,
            "SECRET_KEY": "test-secret",
            "JWT_SECRET_KEY": "test-jwt-secret",
            "UPLOAD_FOLDER": str(Path(self.temp_dir.name) / "uploads"),
            "INIT_DB_ON_STARTUP": "0",
            "PGSSLMODE": "disable",
        }
        with patch.dict(os.environ, env, clear=False):
            from app import create_app

            self.app = create_app()
        from extensions import db

        with self.app.app_context():
            db.create_all()

    def tearDown(self):
        from extensions import db

        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        if self.admin_engine is not None:
            with self.admin_engine.begin() as conn:
                conn.execute(text(f'DROP SCHEMA IF EXISTS "{self.pg_schema}" CASCADE'))
            self.admin_engine.dispose()
        self.temp_dir.cleanup()

    def test_unique_values_are_scoped_to_workspace(self):
        from extensions import db
        from models import (
            Contract,
            Customer,
            Invoice,
            MaterialItem,
            Quote,
            ServiceCatalogItem,
            Workspace,
        )

        with self.app.app_context():
            first = Workspace(name="First", slug="first", plan="free")
            second = Workspace(name="Second", slug="second", plan="free")
            db.session.add_all([first, second])
            db.session.flush()
            customers = [
                Customer(workspace_id=first.id, name="Shared customer"),
                Customer(workspace_id=second.id, name="Shared customer"),
            ]
            db.session.add_all(customers)
            db.session.flush()
            quotes = [
                Quote(workspace_id=first.id, quote_no="Q-1", customer_id=customers[0].id),
                Quote(workspace_id=second.id, quote_no="Q-1", customer_id=customers[1].id),
            ]
            db.session.add_all(quotes)
            db.session.flush()
            db.session.add_all(
                [
                    Contract(
                        workspace_id=first.id,
                        contract_no="C-1",
                        quote_id=quotes[0].id,
                        quote_version_no=1,
                        contract_date=date(2026, 1, 1),
                        project_name="Project",
                        party_a_name="A",
                        party_b_name="B",
                        payment_terms="Net 30",
                        quote_snapshot_json="{}",
                    ),
                    Contract(
                        workspace_id=second.id,
                        contract_no="C-1",
                        quote_id=quotes[1].id,
                        quote_version_no=1,
                        contract_date=date(2026, 1, 1),
                        project_name="Project",
                        party_a_name="A",
                        party_b_name="B",
                        payment_terms="Net 30",
                        quote_snapshot_json="{}",
                    ),
                    Invoice(workspace_id=first.id, invoice_no="I-1", customer_id=customers[0].id),
                    Invoice(workspace_id=second.id, invoice_no="I-1", customer_id=customers[1].id),
                    ServiceCatalogItem(workspace_id=first.id, name="Shared service"),
                    ServiceCatalogItem(workspace_id=second.id, name="Shared service"),
                    MaterialItem(workspace_id=first.id, name="Shared material", spec="M1"),
                    MaterialItem(workspace_id=second.id, name="Shared material", spec="M1"),
                ]
            )
            db.session.commit()

            duplicates = [
                Customer(workspace_id=first.id, name="Shared customer"),
                Quote(workspace_id=first.id, quote_no="Q-1", customer_id=customers[0].id),
                Contract(
                    workspace_id=first.id,
                    contract_no="C-1",
                    quote_id=quotes[0].id,
                    quote_version_no=1,
                    contract_date=date(2026, 1, 1),
                    project_name="Project",
                    party_a_name="A",
                    party_b_name="B",
                    payment_terms="Net 30",
                    quote_snapshot_json="{}",
                ),
                Invoice(workspace_id=first.id, invoice_no="I-1", customer_id=customers[0].id),
                ServiceCatalogItem(workspace_id=first.id, name="Shared service"),
                MaterialItem(workspace_id=first.id, name="Shared material", spec="M1"),
            ]
            for duplicate in duplicates:
                db.session.add(duplicate)
                with self.assertRaises(IntegrityError, msg=type(duplicate).__name__):
                    db.session.flush()
                db.session.rollback()

    def test_upgrade_replaces_legacy_global_uniques_idempotently(self):
        from extensions import db
        import workspace_migration as migration

        with self.app.app_context():
            from models import (
                Contact,
                Contract,
                ContractVersion,
                Customer,
                Invoice,
                InvoiceItem,
                InvoicePaymentRecord,
                Quote,
                QuoteItem,
                QuoteVersion,
                Workspace,
            )

            workspace = Workspace(name="Existing", slug="existing", plan="free", is_legacy=True)
            db.session.add(workspace)
            db.session.flush()
            customer = Customer(workspace_id=workspace.id, name="Preserved customer")
            db.session.add(customer)
            db.session.flush()
            contact = Contact(workspace_id=workspace.id, customer_id=customer.id, name="Preserved contact")
            quote = Quote(workspace_id=workspace.id, quote_no="PRESERVE-Q", customer_id=customer.id)
            db.session.add_all([contact, quote])
            db.session.flush()
            quote_item = QuoteItem(quote_id=quote.id, description="Preserved quote item", note="quote child")
            quote_version = QuoteVersion(quote_id=quote.id, version_no=1, snapshot_json='{"kept":true}')
            invoice = Invoice(
                workspace_id=workspace.id,
                invoice_no="PRESERVE-I",
                customer_id=customer.id,
                contact_id=contact.id,
                quote_id=quote.id,
            )
            contract = Contract(
                workspace_id=workspace.id,
                contract_no="PRESERVE-C",
                quote_id=quote.id,
                quote_version_no=1,
                contract_date=date(2026, 1, 1),
                project_name="Preserved project",
                party_a_name="A",
                party_b_name="B",
                payment_terms="Net 30",
                quote_snapshot_json='{"contract":"kept"}',
            )
            db.session.add_all([quote_item, quote_version, invoice, contract])
            db.session.flush()
            invoice_item = InvoiceItem(invoice_id=invoice.id, description="Preserved invoice item", note="invoice child")
            payment = InvoicePaymentRecord(invoice_id=invoice.id, amount=12.5, note="preserved payment")
            contract_version = ContractVersion(
                contract_id=contract.id,
                version_no=1,
                snapshot_json='{"version":"kept"}',
            )
            db.session.add_all([invoice_item, payment, contract_version])
            db.session.commit()
            if db.engine.dialect.name == "sqlite":
                with db.engine.begin() as conn:
                    conn.exec_driver_sql("ALTER TABLE customer ADD COLUMN legacy_extension TEXT")
                    conn.exec_driver_sql(
                        "UPDATE customer SET legacy_extension = 'keep-me' WHERE id = " + str(customer.id)
                    )
                    conn.exec_driver_sql(
                        "CREATE INDEX ix_customer_legacy_extension ON customer (legacy_extension)"
                    )
                    conn.exec_driver_sql(
                        "CREATE TRIGGER customer_legacy_trigger AFTER UPDATE OF name ON customer "
                        "BEGIN SELECT 1; END"
                    )

            # Emulate an existing installation created with global uniqueness.
            with migration._migration_transaction() as conn:
                if db.engine.dialect.name == "sqlite":
                    self.assertEqual(conn.exec_driver_sql("PRAGMA foreign_keys").scalar(), 0)
                migration._set_tenant_uniqueness(conn, per_workspace=False)
            with db.engine.connect() as conn:
                for table, (columns, _) in migration.SCOPED_UNIQUES.items():
                    if table not in migration._tables():
                        continue
                    found = [item["columns"] for item in migration._unique_definitions(conn, table)]
                    self.assertIn(columns, found, table)
                    self.assertNotIn(("workspace_id", *columns), found, table)

            before = migration.verify()
            self.assertFalse(before["ok"])
            self.assertIn("customer: legacy global uniqueness still present", before["problems"])
            self.assertIn("customer: workspace-scoped uniqueness missing", before["problems"])

            first_run = migration.upgrade()
            second_run = migration.upgrade()
            after = migration.verify()
            self.assertTrue(after["ok"], after["problems"])
            self.assertFalse(first_run.get("first_run"))
            self.assertFalse(second_run.get("first_run"))
            with db.engine.connect() as conn:
                for table, (columns, _) in migration.SCOPED_UNIQUES.items():
                    found = [item["columns"] for item in migration._unique_definitions(conn, table)]
                    self.assertIn(("workspace_id", *columns), found, table)
                    self.assertNotIn(columns, found, table)
                if db.engine.dialect.name == "sqlite":
                    self.assertEqual(conn.exec_driver_sql("PRAGMA foreign_key_check").all(), [])
                    self.assertEqual(conn.exec_driver_sql("PRAGMA foreign_keys").scalar(), 1)
            self.assertEqual(Customer.query.filter_by(name="Preserved customer").count(), 1)
            self.assertEqual(Contact.query.filter_by(name="Preserved contact").count(), 1)
            self.assertEqual(QuoteItem.query.filter_by(description="Preserved quote item").one().note, "quote child")
            self.assertEqual(InvoiceItem.query.filter_by(description="Preserved invoice item").one().note, "invoice child")
            self.assertEqual(InvoicePaymentRecord.query.one().note, "preserved payment")
            self.assertEqual(QuoteVersion.query.one().snapshot_json, '{"kept":true}')
            self.assertEqual(ContractVersion.query.one().snapshot_json, '{"version":"kept"}')
            if db.engine.dialect.name == "sqlite":
                with db.engine.connect() as conn:
                    self.assertEqual(
                        conn.exec_driver_sql(
                            "SELECT legacy_extension FROM customer WHERE name = 'Preserved customer'"
                        ).scalar(),
                        "keep-me",
                    )
                    self.assertIsNotNone(
                        conn.exec_driver_sql(
                            "SELECT 1 FROM sqlite_master WHERE type='index' AND name='ix_customer_legacy_extension'"
                        ).scalar()
                    )
                    self.assertIsNotNone(
                        conn.exec_driver_sql(
                            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='customer_legacy_trigger'"
                        ).scalar()
                    )

            db.session.remove()
            migration.downgrade()
            with db.engine.connect() as conn:
                self.assertEqual(
                    conn.exec_driver_sql("SELECT COUNT(*) FROM customer WHERE name='Preserved customer'").scalar(), 1
                )
                self.assertEqual(
                    conn.exec_driver_sql("SELECT name FROM contact WHERE name='Preserved contact'").scalar(),
                    "Preserved contact",
                )
                self.assertEqual(
                    conn.exec_driver_sql("SELECT note FROM quote_item WHERE description='Preserved quote item'").scalar(),
                    "quote child",
                )
                self.assertEqual(
                    conn.exec_driver_sql("SELECT note FROM invoice_item WHERE description='Preserved invoice item'").scalar(),
                    "invoice child",
                )
                self.assertEqual(
                    conn.exec_driver_sql("SELECT note FROM invoice_payment_record").scalar(), "preserved payment"
                )
                self.assertEqual(conn.exec_driver_sql("SELECT snapshot_json FROM quote_version").scalar(), '{"kept":true}')
                self.assertEqual(conn.exec_driver_sql("SELECT snapshot_json FROM contract_version").scalar(), '{"version":"kept"}')
            if db.engine.dialect.name == "sqlite":
                with db.engine.connect() as conn:
                    self.assertEqual(
                        conn.exec_driver_sql(
                            "SELECT legacy_extension FROM customer WHERE name = 'Preserved customer'"
                        ).scalar(),
                        "keep-me",
                    )
                    self.assertEqual(conn.exec_driver_sql("PRAGMA foreign_key_check").all(), [])
                    self.assertEqual(conn.exec_driver_sql("PRAGMA foreign_keys").scalar(), 1)

    def test_downgrade_refuses_null_workspace_global_duplicates(self):
        from extensions import db
        from models import Customer
        import workspace_migration as migration

        with self.app.app_context():
            db.session.add_all(
                [Customer(name="Unassigned duplicate"), Customer(name="Unassigned duplicate")]
            )
            db.session.commit()
            with self.assertRaises(migration.MigrationError):
                migration.downgrade()

    def test_sqlite_rebuild_fails_closed_on_existing_temporary_table(self):
        from extensions import db
        import workspace_migration as migration

        with self.app.app_context():
            if db.engine.dialect.name != "sqlite":
                self.skipTest("SQLite-only rebuild guard")
            with db.engine.begin() as conn:
                conn.exec_driver_sql("CREATE TABLE customer__workspace_rebuild (sentinel TEXT)")
                conn.exec_driver_sql("INSERT INTO customer__workspace_rebuild VALUES ('leave-alone')")
            with self.assertRaises(migration.MigrationError):
                with migration._migration_transaction() as conn:
                    migration._set_tenant_uniqueness(conn, per_workspace=False)
            with db.engine.connect() as conn:
                self.assertEqual(
                    conn.exec_driver_sql("SELECT sentinel FROM customer__workspace_rebuild").scalar(),
                    "leave-alone",
                )


if __name__ == "__main__":
    unittest.main()
