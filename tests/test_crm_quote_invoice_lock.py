import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from extensions import db
from models import Customer, Invoice, Quote, QuoteItem
from routes import crm


class QuoteInvoiceLockTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{Path(self.tmpdir.name) / 'test.db'}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            TESTING=True,
            SECRET_KEY="test",
        )
        db.init_app(self.app)
        self.app.register_blueprint(crm.crm_bp, url_prefix="/api/crm")
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self._original_get_current_user_id = crm.get_current_user_id
        crm.get_current_user_id = lambda: 7

    def tearDown(self):
        crm.get_current_user_id = self._original_get_current_user_id
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.ctx.pop()
        self.tmpdir.cleanup()

    def _make_quote_with_invoice(self, *, invoice_status="issued"):
        customer = Customer(name="標泰汽車材料", address="湖仔內路")
        db.session.add(customer)
        db.session.flush()
        quote = Quote(
            quote_no="QT-20260706-001",
            status="accepted",
            customer_id=customer.id,
            issue_date=date(2026, 7, 6),
            expiry_date=date(2026, 8, 4),
            currency="TWD",
            subtotal=100,
            total_amount=100,
        )
        db.session.add(quote)
        db.session.flush()
        db.session.add(
            QuoteItem(
                quote_id=quote.id,
                description="浴室冷熱給水排水工程",
                unit="間",
                quantity=1,
                unit_price=100,
                amount=100,
                sort_order=0,
            )
        )
        db.session.add(
            Invoice(
                invoice_no="INV-20260706-001",
                status=invoice_status,
                customer_id=customer.id,
                quote_id=quote.id,
                issue_date=date(2026, 7, 6),
                due_date=date(2026, 8, 4),
                currency="TWD",
                subtotal=100,
                total_amount=100,
            )
        )
        db.session.commit()
        return quote

    def test_update_quote_is_blocked_when_active_invoice_exists(self):
        quote = self._make_quote_with_invoice(invoice_status="issued")

        invoice = crm._active_invoice_for_quote(quote.id)

        self.assertIsNotNone(invoice)
        self.assertEqual(invoice.invoice_no, "INV-20260706-001")

    def test_update_quote_is_allowed_when_invoice_is_cancelled(self):
        quote = self._make_quote_with_invoice(invoice_status="cancelled")

        invoice = crm._active_invoice_for_quote(quote.id)

        self.assertIsNone(invoice)


if __name__ == "__main__":
    unittest.main()
