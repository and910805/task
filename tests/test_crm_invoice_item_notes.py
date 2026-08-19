import sys
import tempfile
import unittest
from datetime import date
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import create_access_token


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from extensions import db, jwt
from models import Customer, Invoice, InvoiceItem, Quote, QuoteItem, User
from routes import crm
from schema_migrations import ensure_invoice_item_note_column


class CrmInvoiceItemNoteTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{Path(self.tmpdir.name) / 'test.db'}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            TESTING=True,
            SECRET_KEY="test-secret",
            JWT_SECRET_KEY="test-jwt-secret",
        )
        db.init_app(self.app)
        jwt.init_app(self.app)
        self.app.register_blueprint(crm.crm_bp, url_prefix="/api/crm")

        with self.app.app_context():
            db.create_all()
            manager = User(username="invoice-note-manager", role="hq_staff")
            manager.set_password("irrelevant-test-password")
            customer = Customer(name="郵差大哥")
            db.session.add_all([manager, customer])
            db.session.flush()
            quote = Quote(
                quote_no="QT-20260819-001",
                status="accepted",
                customer_id=customer.id,
                issue_date=date(2026, 8, 19),
                expiry_date=date(2026, 8, 29),
                currency="TWD",
                subtotal=3200,
                total_amount=3200,
            )
            db.session.add(quote)
            db.session.flush()
            db.session.add(
                QuoteItem(
                    quote_id=quote.id,
                    description="浴室換氣扇",
                    unit="台",
                    note="電光牌",
                    quantity=1,
                    unit_price=3200,
                    amount=3200,
                    sort_order=0,
                )
            )
            db.session.commit()
            self.quote_id = quote.id
            self.customer_id = customer.id
            self.token = create_access_token(
                identity=str(manager.id), additional_claims={"role": manager.role}
            )

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
            db.engine.dispose()
        self.tmpdir.cleanup()

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"}

    def test_quote_item_note_survives_conversion_and_reaches_pdf_builder(self):
        response = self.app.test_client().post(
            f"/api/crm/quotes/{self.quote_id}/convert-to-invoice",
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        payload = response.get_json()["invoice"]
        self.assertEqual(payload["items"][0]["note"], "電光牌")

        with self.app.app_context():
            invoice = db.session.get(Invoice, payload["id"])
            customer = db.session.get(Customer, self.customer_id)
            captured = {}

            def capture_pdf(quote_like, *_args, **_kwargs):
                captured["note"] = quote_like.items[0].note
                return BytesIO(b"%PDF-test")

            with patch.object(crm, "_build_quote_template_pdf", side_effect=capture_pdf):
                crm._build_invoice_template_pdf(invoice, customer, None)

            self.assertEqual(captured["note"], "電光牌")

    def test_migration_repairs_an_existing_invoice_item_without_overwriting_notes(self):
        with self.app.app_context():
            invoice = Invoice(
                invoice_no="INV-20260819-001",
                status="issued",
                customer_id=self.customer_id,
                quote_id=self.quote_id,
                issue_date=date(2026, 8, 19),
                due_date=date(2026, 8, 29),
                currency="TWD",
                subtotal=3200,
                total_amount=3200,
            )
            db.session.add(invoice)
            db.session.flush()
            missing_note = InvoiceItem(
                invoice_id=invoice.id,
                description="浴室換氣扇",
                unit="台",
                note=None,
                quantity=1,
                unit_price=3200,
                amount=3200,
                sort_order=0,
            )
            preserved_note = InvoiceItem(
                invoice_id=invoice.id,
                description="浴室換氣扇",
                unit="台",
                note="人工指定品牌",
                quantity=1,
                unit_price=3200,
                amount=3200,
                sort_order=1,
            )
            db.session.add_all([missing_note, preserved_note])
            db.session.commit()
            missing_id = missing_note.id
            preserved_id = preserved_note.id

            ensure_invoice_item_note_column()
            db.session.expire_all()

            self.assertEqual(db.session.get(InvoiceItem, missing_id).note, "電光牌")
            self.assertEqual(db.session.get(InvoiceItem, preserved_id).note, "人工指定品牌")


if __name__ == "__main__":
    unittest.main()
