import base64
import io
import os
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask, jsonify
from flask_jwt_extended import create_access_token


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from decorators import jwt_user_claims_are_current, role_required
from extensions import db, jwt
from models import Attachment, Contract, Customer, Invoice, Quote, Task, User
from routes import auth, crm, export, line, tasks
from routes.uploads import upload_bp
from rate_limit import _BUCKETS, _LOCK, rate_limit
from storage import LocalStorage, StorageError


class LocalStorageSecurityTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp_dir.name) / "uploads"
        self.storage = LocalStorage(self.base_dir)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_normal_file_round_trip_stays_inside_upload_directory(self):
        relative_path = self.storage.save("images/example.png", io.BytesIO(b"image"))

        self.assertEqual(relative_path, "images/example.png")
        self.assertEqual(self.storage.local_path(relative_path).read_bytes(), b"image")

    def test_parent_traversal_is_rejected_for_all_file_operations(self):
        outside = Path(self.temp_dir.name) / "outside.txt"
        outside.write_text("private", encoding="utf-8")

        for operation in (
            lambda: self.storage.save("../outside.txt", io.BytesIO(b"overwrite")),
            lambda: self.storage.local_path("../outside.txt"),
            lambda: self.storage.delete("../outside.txt"),
        ):
            with self.subTest(operation=operation):
                with self.assertRaises(StorageError):
                    operation()

        self.assertEqual(outside.read_text(encoding="utf-8"), "private")

    def test_windows_style_parent_traversal_is_rejected(self):
        with self.assertRaises(StorageError):
            self.storage.local_path(r"..\outside.txt")


class WebhookSignatureSecurityTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    def test_missing_line_secret_fails_closed(self):
        with (
            self.app.test_request_context("/api/line/webhook", method="POST"),
            patch.object(line, "line_channel_secret", return_value=""),
            patch.dict(os.environ, {}, clear=False),
        ):
            os.environ.pop("ALLOW_UNSIGNED_LINE_WEBHOOKS", None)
            self.assertFalse(line._verify_request())

    def test_unsigned_webhook_requires_explicit_opt_in(self):
        with (
            self.app.test_request_context("/api/line/webhook", method="POST"),
            patch.object(line, "line_channel_secret", return_value=""),
            patch.dict(os.environ, {"ALLOW_UNSIGNED_LINE_WEBHOOKS": "1"}, clear=False),
        ):
            self.assertTrue(line._verify_request())


class PasswordPolicySecurityTest(unittest.TestCase):
    def test_short_and_excessively_long_passwords_are_rejected(self):
        self.assertIsNotNone(auth._password_error("short"))
        self.assertIsNotNone(auth._password_error("x" * (auth.MAX_PASSWORD_LENGTH + 1)))

    def test_generated_password_meets_policy(self):
        self.assertIsNone(auth._password_error(auth._generate_password()))

    def test_public_registration_is_disabled_by_default(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ALLOW_PUBLIC_WORKER_REGISTRATION", None)
            self.assertFalse(auth._public_registration_enabled())

    def test_public_registration_requires_explicit_opt_in(self):
        with patch.dict(
            os.environ,
            {"ALLOW_PUBLIC_WORKER_REGISTRATION": "true"},
            clear=False,
        ):
            self.assertTrue(auth._public_registration_enabled())


class SpreadsheetFormulaSecurityTest(unittest.TestCase):
    def test_untrusted_formula_prefixes_are_escaped(self):
        for value in ("=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "  =HYPERLINK(\"x\")"):
            with self.subTest(value=value):
                self.assertTrue(crm._xlsx_safe_text(value).startswith("'"))
                self.assertTrue(export._safe_excel_text(value).startswith("'"))

    def test_regular_text_is_unchanged(self):
        self.assertEqual(crm._xlsx_safe_text("正常備註"), "正常備註")
        self.assertEqual(export._safe_excel_text("正常備註"), "正常備註")


class PdfMarkupSecurityTest(unittest.TestCase):
    def test_quote_pdf_treats_free_text_as_literal_content(self):
        injected_markup = '<img src="http://127.0.0.1:9/probe.png"/>'
        quote = SimpleNamespace(
            recipient_name=f"客戶{injected_markup}",
            site_address=f"地址{injected_markup}",
            customer_signature_name=f"簽名{injected_markup}",
            customer_signed_at=None,
            customer_signature_path=None,
            items=[],
            tax_amount=0,
            tax_rate=0,
            total_amount=0,
            subtotal=0,
            quote_no="QT-SECURITY",
            issue_date=date.today(),
            expiry_date=date.today(),
            note=f"備註{injected_markup}",
        )

        with (
            patch.object(crm, "_require_embedded_pdf_font"),
            patch.object(crm, "_resolve_pdf_stamp_path", return_value=None),
            patch.object(crm.SimpleDocTemplate, "build", return_value=None),
            patch(
                "reportlab.platypus.paraparser.ImageReader",
                side_effect=AssertionError("PDF text triggered an outbound image fetch"),
            ),
        ):
            crm._build_quote_template_pdf(quote, None, None)


class PublicEndpointRateLimitSecurityTest(unittest.TestCase):
    def setUp(self):
        with _LOCK:
            _BUCKETS.clear()
        self.app = Flask(__name__)

        @self.app.post("/limited")
        @rate_limit("test", limit=2, window_seconds=60)
        def limited():
            return jsonify({"ok": True})

    def tearDown(self):
        with _LOCK:
            _BUCKETS.clear()

    def test_excess_requests_receive_429_and_retry_after(self):
        client = self.app.test_client()

        self.assertEqual(client.post("/limited").status_code, 200)
        self.assertEqual(client.post("/limited").status_code, 200)
        response = client.post("/limited")

        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)


class RoleAuthorizationSecurityTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI="sqlite://",
            SECRET_KEY="test-secret",
            JWT_SECRET_KEY="test-jwt-secret",
        )
        db.init_app(self.app)
        jwt.init_app(self.app)

        @self.app.get("/admin-only")
        @role_required("admin")
        def admin_only():
            return jsonify({"ok": True})

        with self.app.app_context():
            db.create_all()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_stale_admin_claim_does_not_override_database_role(self):
        with self.app.app_context():
            user = User(username="worker", role="worker")
            user.set_password("irrelevant-test-password")
            db.session.add(user)
            db.session.commit()
            token = create_access_token(
                identity=str(user.id),
                additional_claims={"role": "admin"},
            )

        response = self.app.test_client().get(
            "/admin-only",
            headers={"Authorization": f"Bearer {token}"},
        )

        self.assertEqual(response.status_code, 403)

    def test_global_jwt_verification_rejects_stale_role_and_deleted_user(self):
        with self.app.app_context():
            user = User(username="claim-check", role="worker")
            user.set_password("irrelevant-test-password")
            db.session.add(user)
            db.session.commit()
            user_id = user.id

            self.assertTrue(
                jwt_user_claims_are_current({"sub": str(user_id), "role": "worker"})
            )
            self.assertFalse(
                jwt_user_claims_are_current({"sub": str(user_id), "role": "admin"})
            )

            db.session.delete(user)
            db.session.commit()
            self.assertFalse(
                jwt_user_claims_are_current({"sub": str(user_id), "role": "worker"})
            )


class DownloadAuthorizationSecurityTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI="sqlite://",
            SECRET_KEY="test-secret",
            JWT_SECRET_KEY="test-jwt-secret",
        )
        db.init_app(self.app)
        jwt.init_app(self.app)
        self.app.register_blueprint(upload_bp, url_prefix="/api/upload")
        self.app.register_blueprint(tasks.tasks_bp, url_prefix="/api/tasks")
        self.app.extensions["storage"] = LocalStorage(Path(self.temp_dir.name) / "uploads")

        with self.app.app_context():
            db.create_all()
            assigned = User(username="assigned", role="worker")
            assigned.set_password("irrelevant-test-password")
            other = User(username="other", role="worker")
            other.set_password("irrelevant-test-password")
            supervisor = User(username="unrelated-supervisor", role="site_supervisor")
            supervisor.set_password("irrelevant-test-password")
            db.session.add_all([assigned, other, supervisor])
            db.session.flush()

            task = Task(
                title="Security test",
                description="Security test",
                location="Test",
                expected_time=datetime.utcnow(),
                assigned_to_id=assigned.id,
            )
            db.session.add(task)
            db.session.flush()
            db.session.add(
                Attachment(
                    task_id=task.id,
                    uploaded_by_id=assigned.id,
                    file_type="image",
                    original_name="example.png",
                    file_path="images/example.png",
                )
            )
            db.session.add(
                Attachment(
                    task_id=task.id,
                    uploaded_by_id=assigned.id,
                    file_type="other",
                    original_name="readme.txt",
                    file_path="other/readme.txt",
                )
            )
            db.session.commit()

            self.assigned_id = assigned.id
            self.other_id = other.id
            self.task_id = task.id
            self.path_token = create_access_token(
                identity=str(assigned.id),
                additional_claims={"download_path": "images/example.png"},
            )
            self.general_token = create_access_token(
                identity=str(assigned.id),
                additional_claims={"role": assigned.role},
            )
            self.other_token = create_access_token(identity=str(other.id))
            self.supervisor_token = create_access_token(
                identity=str(supervisor.id),
                additional_claims={"role": supervisor.role},
            )

        self.app.extensions["storage"].save("images/example.png", io.BytesIO(b"image"))
        self.app.extensions["storage"].save("other/readme.txt", io.BytesIO(b"notes"))

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.temp_dir.cleanup()

    def test_path_bound_query_token_can_only_download_its_file(self):
        client = self.app.test_client()

        allowed = client.get(
            f"/api/upload/files/images/example.png?token={self.path_token}"
        )
        rejected = client.get(
            f"/api/upload/files/images/other.png?token={self.path_token}"
        )

        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(rejected.status_code, 401)

    def test_general_access_token_is_not_accepted_in_query_string(self):
        response = self.app.test_client().get(
            f"/api/upload/files/images/example.png?token={self.general_token}"
        )

        self.assertEqual(response.status_code, 401)

    def test_worker_cannot_download_another_tasks_attachment(self):
        response = self.app.test_client().get(
            "/api/upload/files/images/example.png",
            headers={"Authorization": f"Bearer {self.other_token}"},
        )

        self.assertEqual(response.status_code, 404)

    def test_supervisor_cannot_download_unrelated_task_attachment(self):
        response = self.app.test_client().get(
            "/api/upload/files/images/example.png",
            headers={"Authorization": f"Bearer {self.supervisor_token}"},
        )

        self.assertEqual(response.status_code, 404)

    def test_script_disguised_as_jpeg_is_rejected(self):
        response = self.app.test_client().post(
            f"/api/upload/tasks/{self.task_id}/images",
            data={"file": (io.BytesIO(b"<script>alert(1)</script>"), "payload.jpg")},
            headers={"Authorization": f"Bearer {self.general_token}"},
        )

        self.assertEqual(response.status_code, 400)

    def test_non_png_signature_payload_is_rejected(self):
        encoded = base64.b64encode(b"<script>alert(1)</script>").decode("ascii")
        response = self.app.test_client().post(
            f"/api/upload/tasks/{self.task_id}/signature",
            json={"data_url": f"data:image/png;base64,{encoded}"},
            headers={"Authorization": f"Bearer {self.general_token}"},
        )

        self.assertEqual(response.status_code, 400)

    def test_executable_other_attachment_is_rejected(self):
        response = self.app.test_client().post(
            f"/api/tasks/{self.task_id}/attachments",
            data={
                "file": (io.BytesIO(b"<script>alert(1)</script>"), "payload.html"),
                "file_type": "other",
            },
            headers={"Authorization": f"Bearer {self.general_token}"},
        )

        self.assertEqual(response.status_code, 400)

    def test_other_attachment_is_forced_to_download(self):
        response = self.app.test_client().get(
            "/api/tasks/attachments/other/readme.txt",
            headers={"Authorization": f"Bearer {self.general_token}"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response.headers.get("Content-Disposition", ""))


class TaskOwnershipSecurityTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI="sqlite://",
            SECRET_KEY="test-secret",
            JWT_SECRET_KEY="test-jwt-secret",
        )
        db.init_app(self.app)
        jwt.init_app(self.app)
        self.app.register_blueprint(tasks.tasks_bp, url_prefix="/api/tasks")
        self.app.extensions["storage"] = LocalStorage(Path(self.temp_dir.name) / "uploads")

        with self.app.app_context():
            db.create_all()
            owner = User(username="task-owner", role="site_supervisor")
            owner.set_password("irrelevant-test-password")
            intruder = User(username="other-supervisor", role="site_supervisor")
            intruder.set_password("irrelevant-test-password")
            admin = User(username="task-admin", role="admin")
            admin.set_password("irrelevant-test-password")
            db.session.add_all([owner, intruder, admin])
            db.session.flush()
            task = Task(
                title="Private task",
                description="Owner only",
                location="Test",
                expected_time=datetime.utcnow(),
                assigned_by_id=owner.id,
            )
            db.session.add(task)
            db.session.commit()
            self.task_id = task.id
            self.intruder_token = create_access_token(
                identity=str(intruder.id),
                additional_claims={"role": intruder.role},
            )
            self.owner_token = create_access_token(
                identity=str(owner.id),
                additional_claims={"role": owner.role},
            )
            self.admin_token = create_access_token(
                identity=str(admin.id),
                additional_claims={"role": admin.role},
            )

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.temp_dir.cleanup()

    def test_supervisor_cannot_read_update_or_delete_another_supervisors_task(self):
        client = self.app.test_client()
        headers = {"Authorization": f"Bearer {self.intruder_token}"}

        self.assertEqual(client.get(f"/api/tasks/{self.task_id}", headers=headers).status_code, 403)
        self.assertEqual(
            client.put(f"/api/tasks/{self.task_id}", json={}, headers=headers).status_code,
            403,
        )
        self.assertEqual(
            client.delete(f"/api/tasks/{self.task_id}", headers=headers).status_code,
            403,
        )

    def test_archived_task_is_hidden_by_default_and_can_be_restored(self):
        client = self.app.test_client()
        headers = {"Authorization": f"Bearer {self.owner_token}"}

        archived = client.post(f"/api/tasks/{self.task_id}/archive", headers=headers)
        self.assertEqual(archived.status_code, 200)
        self.assertIsNotNone(archived.get_json()["archived_at"])

        default_rows = client.get("/api/tasks/", headers=headers).get_json()
        archived_rows = client.get(
            "/api/tasks/?include_archived=1", headers=headers
        ).get_json()
        self.assertEqual(default_rows, [])
        self.assertEqual([row["id"] for row in archived_rows], [self.task_id])

        restored = client.post(f"/api/tasks/{self.task_id}/restore", headers=headers)
        self.assertEqual(restored.status_code, 200)
        self.assertIsNone(restored.get_json()["archived_at"])

    def test_only_admin_can_permanently_delete_task(self):
        client = self.app.test_client()
        owner_headers = {"Authorization": f"Bearer {self.owner_token}"}
        admin_headers = {"Authorization": f"Bearer {self.admin_token}"}

        self.assertEqual(
            client.delete(f"/api/tasks/{self.task_id}", headers=owner_headers).status_code,
            403,
        )
        self.assertEqual(
            client.delete(f"/api/tasks/{self.task_id}", headers=admin_headers).status_code,
            200,
        )


class CrmAuthorizationSecurityTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI="sqlite://",
            SECRET_KEY="test-secret",
            JWT_SECRET_KEY="test-jwt-secret",
        )
        db.init_app(self.app)
        jwt.init_app(self.app)
        self.app.register_blueprint(crm.crm_bp, url_prefix="/api/crm")

        with self.app.app_context():
            db.create_all()
            worker = User(username="crm-worker", role="worker")
            worker.set_password("irrelevant-test-password")
            manager = User(username="crm-manager", role="hq_staff")
            manager.set_password("irrelevant-test-password")
            db.session.add_all([worker, manager])
            db.session.flush()
            customer = Customer(name="CRM bootstrap customer", created_by_id=manager.id)
            db.session.add(customer)
            db.session.flush()
            quote = Quote(
                quote_no="QT-BOOT-001",
                customer_id=customer.id,
                issue_date=date.today(),
                expiry_date=date.today(),
                created_by_id=manager.id,
            )
            db.session.add(quote)
            db.session.flush()
            db.session.add_all(
                [
                    Invoice(
                        invoice_no="IV-BOOT-001",
                        customer_id=customer.id,
                        quote_id=quote.id,
                        issue_date=date.today(),
                        due_date=date.today(),
                        created_by_id=manager.id,
                    ),
                    Contract(
                        contract_no="CT-BOOT-001",
                        quote_id=quote.id,
                        quote_version_no=1,
                        contract_date=date.today(),
                        project_name="Bootstrap project",
                        party_a_name=customer.name,
                        party_b_name="Test contractor",
                        payment_terms="Test payment terms",
                        quote_snapshot_json="{}",
                        created_by_id=manager.id,
                    ),
                ]
            )
            db.session.commit()
            self.worker_token = create_access_token(
                identity=str(worker.id), additional_claims={"role": worker.role}
            )
            self.manager_token = create_access_token(
                identity=str(manager.id), additional_claims={"role": manager.role}
            )

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_crm_bootstrap_rejects_workers_and_allows_managers(self):
        client = self.app.test_client()
        worker_response = client.get(
            "/api/crm/boot",
            headers={"Authorization": f"Bearer {self.worker_token}"},
        )
        manager_response = client.get(
            "/api/crm/boot",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )

        self.assertEqual(worker_response.status_code, 403)
        self.assertEqual(manager_response.status_code, 200)
        payload = manager_response.get_json()
        for key in ("customers", "contacts", "quotes", "invoices", "contracts", "catalog_items"):
            self.assertIsInstance(payload.get(key), list)
        self.assertEqual([row["quote_no"] for row in payload["quotes"]], ["QT-BOOT-001"])
        self.assertEqual([row["invoice_no"] for row in payload["invoices"]], ["IV-BOOT-001"])
        self.assertEqual([row["contract_no"] for row in payload["contracts"]], ["CT-BOOT-001"])


if __name__ == "__main__":
    unittest.main()
