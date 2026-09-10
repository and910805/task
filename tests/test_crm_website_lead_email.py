import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from extensions import db
from models import User, WebsiteBooking
from rate_limit import _BUCKETS, _LOCK
from routes import crm


class CrmWebsiteLeadEmailTest(unittest.TestCase):
    def setUp(self):
        with _LOCK:
            _BUCKETS.clear()
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{Path(self.tmpdir.name) / 'test.db'}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            TESTING=True,
            APP_BASE_URL="https://task.example.test",
        )
        db.init_app(self.app)
        self.app.register_blueprint(crm.crm_bp, url_prefix="/api/crm")

        with self.app.app_context():
            db.create_all()
            admin = User(
                username="lead-admin",
                role="admin",
                notification_type="email",
                notification_value="owner@example.test",
            )
            admin.set_password("irrelevant-test-password")
            db.session.add(admin)
            db.session.commit()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
            db.engine.dispose()
        self.tmpdir.cleanup()
        with _LOCK:
            _BUCKETS.clear()

    def test_new_lead_is_saved_before_email_is_queued(self):
        with (
            patch.dict(os.environ, {}, clear=False),
            patch.object(crm, "send_email_async") as send_email,
        ):
            os.environ.pop("WEBSITE_LEAD_NOTIFICATION_EMAILS", None)
            response = self.app.test_client().post(
                "/api/crm/public/bookings",
                json={
                    "name": "王先生",
                    "phone": "0912345678",
                    "email": "customer@example.test",
                    "service": "配電工程",
                    "inquiry_type": "quote",
                    "address": "嘉義市測試路 1 號",
                    "message": "請先電話聯絡",
                    "source_channel": "official-website",
                },
            )

        self.assertEqual(response.status_code, 201, response.get_json())
        booking_id = response.get_json()["booking_id"]
        with self.app.app_context():
            self.assertIsNotNone(db.session.get(WebsiteBooking, booking_id))

        send_email.assert_called_once()
        recipients, subject, message = send_email.call_args.args
        self.assertEqual(recipients, ["owner@example.test"])
        self.assertIn("新詢價", subject)
        self.assertIn("王先生", subject)
        self.assertIn("嘉義市測試路 1 號", message)
        self.assertIn("https://task.example.test/crm/bookings", message)

    def test_explicit_recipient_list_overrides_admin_preferences(self):
        with (
            self.app.app_context(),
            patch.dict(
                os.environ,
                {"WEBSITE_LEAD_NOTIFICATION_EMAILS": "sales@example.test; boss@example.test"},
                clear=False,
            ),
        ):
            self.assertEqual(
                crm._website_lead_notification_recipients(),
                ["sales@example.test", "boss@example.test"],
            )


if __name__ == "__main__":
    unittest.main()
