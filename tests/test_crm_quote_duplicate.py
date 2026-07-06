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
from models import Customer, Quote, QuoteItem, QuoteVersion
from routes import crm


class QuoteDuplicateTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{Path(self.tmpdir.name) / 'test.db'}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            TESTING=True,
        )
        db.init_app(self.app)
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

    def test_duplicate_quote_creates_draft_copy_with_items_and_new_dates(self):
        customer = Customer(name="標泰汽車材料", address="湖仔內路")
        db.session.add(customer)
        db.session.flush()
        original = Quote(
            quote_no="QT-20260706-001",
            status="accepted",
            customer_id=customer.id,
            recipient_name="標泰汽車材料",
            site_address="湖仔內路",
            issue_date=date(2026, 7, 6),
            expiry_date=date(2026, 8, 4),
            currency="TWD",
            tax_rate=5,
            subtotal=2000,
            tax_amount=100,
            total_amount=2100,
            note="原備註",
            created_by_id=3,
        )
        db.session.add(original)
        db.session.flush()
        db.session.add_all(
            [
                QuoteItem(
                    quote_id=original.id,
                    description="浴室冷熱給水排水工程",
                    unit="間",
                    note="含材料",
                    quantity=2,
                    unit_price=1000,
                    amount=2000,
                    sort_order=0,
                ),
                QuoteItem(
                    quote_id=original.id,
                    description="以下空白",
                    unit="",
                    quantity=0,
                    unit_price=0,
                    amount=0,
                    sort_order=1,
                ),
            ]
        )
        db.session.add(
            QuoteVersion(
                quote_id=original.id,
                version_no=1,
                action="create",
                summary="original",
                snapshot_json="{}",
            )
        )
        db.session.commit()

        copied = crm._duplicate_quote(original, today=date(2026, 7, 10))
        db.session.commit()

        self.assertNotEqual(copied.id, original.id)
        self.assertNotEqual(copied.quote_no, original.quote_no)
        self.assertTrue(copied.quote_no.startswith("QT-20260710-"))
        self.assertEqual(copied.status, "draft")
        self.assertEqual(copied.customer_id, original.customer_id)
        self.assertEqual(copied.recipient_name, original.recipient_name)
        self.assertEqual(copied.site_address, original.site_address)
        self.assertEqual(copied.issue_date, date(2026, 7, 10))
        self.assertEqual(copied.expiry_date, date(2026, 8, 8))
        self.assertEqual(copied.tax_rate, original.tax_rate)
        self.assertEqual(copied.total_amount, original.total_amount)
        self.assertEqual(copied.created_by_id, 7)
        self.assertEqual([item.description for item in copied.items], ["浴室冷熱給水排水工程", "以下空白"])
        self.assertEqual(copied.items[0].note, "含材料")
        self.assertEqual(copied.items[0].amount, 2000)
        self.assertEqual(len(copied.versions), 1)
        self.assertEqual(copied.versions[0].action, "duplicate")
        self.assertIn("QT-20260706-001", copied.versions[0].summary)


if __name__ == "__main__":
    unittest.main()
