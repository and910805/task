import io
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import create_access_token


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from extensions import db, jwt
from models import Contract, ContractVersion, Customer, Quote, QuoteItem, QuoteVersion, User
from routes import crm


class CrmContractWorkflowTest(unittest.TestCase):
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
            manager = User(username="contract-manager", role="hq_staff")
            manager.set_password("irrelevant-test-password")
            worker = User(username="contract-worker", role="worker")
            worker.set_password("irrelevant-test-password")
            db.session.add_all([manager, worker])
            db.session.flush()

            customer = Customer(
                name="甲方測試客戶",
                tax_id="12345678",
                phone="0912345678",
                address="嘉義市四維南路 A 停車場",
            )
            db.session.add(customer)
            db.session.flush()
            quote = Quote(
                quote_no="QT-20260810-001",
                status="accepted",
                customer_id=customer.id,
                recipient_name=customer.name,
                site_address=customer.address,
                issue_date=date(2026, 8, 10),
                expiry_date=date(2026, 8, 20),
                currency="TWD",
                subtotal=128000,
                total_amount=128000,
            )
            db.session.add(quote)
            db.session.flush()
            db.session.add(
                QuoteItem(
                    quote_id=quote.id,
                    description="停車場照明及配電工程",
                    unit="式",
                    note="依現場放樣施作",
                    quantity=1,
                    unit_price=128000,
                    amount=128000,
                    sort_order=0,
                )
            )
            db.session.commit()

            self.quote_id = quote.id
            self.manager_token = create_access_token(
                identity=str(manager.id), additional_claims={"role": manager.role}
            )
            self.worker_token = create_access_token(
                identity=str(worker.id), additional_claims={"role": worker.role}
            )

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
            db.engine.dispose()
        self.tmpdir.cleanup()

    def _headers(self, token):
        return {"Authorization": f"Bearer {token}"}

    def _create_contract(self):
        return self.app.test_client().post(
            f"/api/crm/quotes/{self.quote_id}/contracts",
            headers=self._headers(self.manager_token),
            json={
                "contract_date": "2026-08-10",
                "project_name": "嘉義市四維南路 A 停車場水電工程",
                "party_a_name": "甲方測試客戶",
                "party_b_name": "立翔水電行",
                "payment_terms": "簽約 30%；進度款 40%；驗收尾款 30%。",
                "warranty_months": 12,
            },
        )

    def test_contract_binds_quote_version_and_keeps_frozen_snapshot(self):
        response = self._create_contract()
        self.assertEqual(response.status_code, 201, response.get_json())
        contract_id = response.get_json()["id"]

        with self.app.app_context():
            contract = db.session.get(Contract, contract_id)
            snapshot_before = contract.quote_snapshot_json
            frozen = json.loads(snapshot_before)
            self.assertEqual(contract.quote_version_no, 1)
            self.assertEqual(frozen["quote"]["items"][0]["description"], "停車場照明及配電工程")
            self.assertEqual(QuoteVersion.query.filter_by(quote_id=self.quote_id).count(), 1)
            self.assertEqual(ContractVersion.query.filter_by(contract_id=contract_id).count(), 1)

            item = QuoteItem.query.filter_by(quote_id=self.quote_id).one()
            item.description = "後來修改的估價品項"
            db.session.commit()
            db.session.refresh(contract)
            self.assertEqual(contract.quote_snapshot_json, snapshot_before)

        update = self.app.test_client().put(
            f"/api/crm/contracts/{contract_id}",
            headers=self._headers(self.manager_token),
            json={"special_terms": "夜間施工須先通知甲方。", "version_summary": "新增夜間施工約定"},
        )
        self.assertEqual(update.status_code, 200, update.get_json())

        versions = self.app.test_client().get(
            f"/api/crm/contracts/{contract_id}/versions",
            headers=self._headers(self.manager_token),
        )
        self.assertEqual(versions.status_code, 200)
        self.assertEqual([row["version_no"] for row in versions.get_json()["versions"]], [2, 1])
        self.assertEqual(versions.get_json()["versions"][0]["summary"], "新增夜間施工約定")

    def test_contract_routes_and_pdf_are_role_protected_and_not_cached(self):
        denied_create = self.app.test_client().post(
            f"/api/crm/quotes/{self.quote_id}/contracts",
            headers=self._headers(self.worker_token),
            json={},
        )
        self.assertEqual(denied_create.status_code, 403)

        created = self._create_contract()
        self.assertEqual(created.status_code, 201)
        contract_id = created.get_json()["id"]

        denied_pdf = self.app.test_client().get(
            f"/api/crm/contracts/{contract_id}/pdf",
            headers=self._headers(self.worker_token),
        )
        self.assertEqual(denied_pdf.status_code, 403)

        with patch.object(crm, "_build_contract_pdf", return_value=io.BytesIO(b"%PDF-test")):
            pdf = self.app.test_client().get(
                f"/api/crm/contracts/{contract_id}/pdf",
                headers=self._headers(self.manager_token),
            )
        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf.mimetype, "application/pdf")
        self.assertIn("no-store", pdf.headers.get("Cache-Control", ""))
        self.assertEqual(pdf.headers.get("Pragma"), "no-cache")

    def test_signed_contract_is_locked_and_source_quote_cannot_be_deleted(self):
        created = self._create_contract()
        self.assertEqual(created.status_code, 201)
        contract_id = created.get_json()["id"]

        marked_signed = self.app.test_client().put(
            f"/api/crm/contracts/{contract_id}",
            headers=self._headers(self.manager_token),
            json={"status": "signed", "version_summary": "雙方完成簽署"},
        )
        self.assertEqual(marked_signed.status_code, 200)

        locked = self.app.test_client().put(
            f"/api/crm/contracts/{contract_id}",
            headers=self._headers(self.manager_token),
            json={"special_terms": "不得覆寫"},
        )
        self.assertEqual(locked.status_code, 409)

        delete_quote = self.app.test_client().delete(
            f"/api/crm/quotes/{self.quote_id}",
            headers=self._headers(self.manager_token),
        )
        self.assertEqual(delete_quote.status_code, 409)
        self.assertEqual(delete_quote.get_json()["contract_id"], contract_id)


if __name__ == "__main__":
    unittest.main()
