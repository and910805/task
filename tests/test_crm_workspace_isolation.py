"""CRM tenant isolation remains effective independently of the legacy gate."""

from datetime import date, datetime
import os
from unittest.mock import patch

from test_workspace_isolation import WorkspaceTestCase


class CrmWorkspaceIsolationTest(WorkspaceTestCase):
    def setUp(self):
        super().setUp()
        from flask import request
        from extensions import db
        from models import Contact, Customer, Quote

        @self.app.before_request
        def prime_foreign_crm_identities():
            if request.headers.get("X-Test-Prime-Foreign") != "1" or not hasattr(self, "ids_b"):
                return
            for model, key in ((Customer, "customer"), (Contact, "contact"), (Quote, "quote")):
                db.session.get(model, self.ids_b[key])

        self.owner_a = self.signup("crm-owner-a", "CRM甲公司")
        self.owner_b = self.signup("crm-owner-b", "CRM乙公司", industry="cleaning")
        from models import (
            AuditLog, Contact, Contract, Customer, Invoice, Quote, ServiceCatalogItem,
        )
        from extensions import db

        self.models = (AuditLog, Contact, Contract, Customer, Invoice, Quote, ServiceCatalogItem)
        with self.app.app_context():
            def seed(workspace_id, suffix):
                customer = Customer(workspace_id=workspace_id, name=f"客戶{suffix}")
                db.session.add(customer)
                db.session.flush()
                contact = Contact(workspace_id=workspace_id, customer_id=customer.id, name=f"聯絡人{suffix}")
                quote = Quote(
                    workspace_id=workspace_id, quote_no=f"QT-{suffix}", customer_id=customer.id,
                    status="draft", issue_date=date.today(),
                )
                catalog = ServiceCatalogItem(workspace_id=workspace_id, name=f"項目{suffix}")
                db.session.add_all([contact, quote, catalog])
                db.session.flush()
                invoice = Invoice(
                    workspace_id=workspace_id, invoice_no=f"INV-{suffix}", customer_id=customer.id,
                    quote_id=quote.id,
                )
                contract = Contract(
                    workspace_id=workspace_id, contract_no=f"CT-{suffix}", quote_id=quote.id,
                    quote_version_no=1, contract_date=date.today(), project_name=f"工程{suffix}",
                    party_a_name=f"甲方{suffix}", party_b_name=f"乙方{suffix}",
                    payment_terms="測試", quote_snapshot_json="{}",
                )
                audit = AuditLog(
                    workspace_id=workspace_id, module="crm", action="test", entity_type="customer",
                    entity_id=str(customer.id), entity_label=f"稽核{suffix}",
                )
                db.session.add_all([invoice, contract, audit])
                db.session.flush()
                return {
                    "customer": customer.id, "contact": contact.id, "quote": quote.id,
                    "invoice": invoice.id, "contract": contract.id, "catalog": catalog.id,
                    "audit": audit.id,
                }

            self.ids_a = seed(self.owner_a["workspace_id"], "A")
            self.ids_b = seed(self.owner_b["workspace_id"], "B")
            from models import WebsiteBooking
            booking_a = WebsiteBooking(
                workspace_id=self.owner_a["workspace_id"], name="名單A", phone="0900000001", service="維修",
            )
            booking_b = WebsiteBooking(
                workspace_id=self.owner_b["workspace_id"], name="名單B", phone="0900000002", service="清潔",
            )
            db.session.add_all([booking_a, booking_b])
            db.session.commit()
            self.ids_a["booking"] = booking_a.id
            self.ids_b["booking"] = booking_b.id

    def _crm_request(self, method, path, owner, **kwargs):
        return getattr(self.client, method)(path, headers=self.headers(owner), **kwargs)

    def test_lists_metrics_and_boot_only_return_current_workspace_rows(self):
        for owner, own, other in ((self.owner_a, self.ids_a, self.ids_b), (self.owner_b, self.ids_b, self.ids_a)):
            for path, key in (
                ("/api/crm/customers", "id"), ("/api/crm/contacts", "id"),
                ("/api/crm/quotes", "id"), ("/api/crm/invoices?limit=all", "id"),
                ("/api/crm/contracts", "id"), ("/api/crm/catalog-items", "id"),
                ("/api/crm/public-bookings", "id"), ("/api/crm/audit-logs", "id"),
            ):
                response = self._crm_request("get", path, owner)
                self.assertEqual(response.status_code, 200, (path, response.get_json()))
                returned_ids = {row[key] for row in response.get_json()}
                kind = path.split("/")[3].split("?")[0]
                model_key = {
                    "customers": "customer", "contacts": "contact", "quotes": "quote",
                    "invoices": "invoice", "contracts": "contract", "catalog-items": "catalog",
                    "public-bookings": "booking",
                }.get(kind)
                if model_key:
                    self.assertIn(own[model_key], returned_ids, path)
                    self.assertNotIn(other[model_key], returned_ids, path)
                elif kind == "audit-logs":
                    labels = {row["entity_label"] for row in response.get_json()}
                    self.assertIn("稽核A" if owner is self.owner_a else "稽核B", labels)
                    self.assertNotIn("稽核B" if owner is self.owner_a else "稽核A", labels)
            boot = self._crm_request("get", "/api/crm/boot", owner).get_json()
            self.assertEqual([r["id"] for r in boot["customers"]], [own["customer"]])
            self.assertEqual([r["id"] for r in boot["contacts"]], [own["contact"]])
            self.assertEqual([r["id"] for r in boot["quotes"]], [own["quote"]])
            metrics = self._crm_request("get", "/api/crm/lead-metrics", owner).get_json()
            self.assertEqual(metrics["summary"]["total_leads"], 1)

    def test_foreign_ids_are_404_for_get_update_history_and_download_handlers(self):
        targets = (
            ("/api/crm/customers/{id}", "customer"),
            ("/api/crm/customers/{id}/service-history", "customer"),
            ("/api/crm/quotes/{id}/versions", "quote"),
            ("/api/crm/quotes/{id}/pdf", "quote"),
            ("/api/crm/quotes/{id}/xlsx", "quote"),
            ("/api/crm/contracts/{id}/versions", "contract"),
            ("/api/crm/contracts/{id}/pdf", "contract"),
            ("/api/crm/invoices/{id}/pdf", "invoice"),
        )
        for path_template, key in targets:
            response = self._crm_request("get", path_template.format(id=self.ids_a[key]), self.owner_b)
            self.assertEqual(response.status_code, 404, (path_template, response.get_json()))

        for path, body in (
            (f"/api/crm/customers/{self.ids_a['customer']}", {"name": "被改名"}),
            (f"/api/crm/contacts/{self.ids_a['contact']}", {"name": "被改名"}),
            (f"/api/crm/quotes/{self.ids_a['quote']}", {"note": "跨租戶"}),
            (f"/api/crm/contracts/{self.ids_a['contract']}", {"special_terms": "跨租戶"}),
            (f"/api/crm/invoices/{self.ids_a['invoice']}", {"note": "跨租戶"}),
            (f"/api/crm/public-bookings/{self.ids_a['booking']}", {"status": "closed"}),
        ):
            response = self._crm_request("put", path, self.owner_b, json=body)
            self.assertEqual(response.status_code, 404, (path, response.get_json()))

        response = self._crm_request(
            "post", f"/api/crm/invoices/{self.ids_a['invoice']}/signature", self.owner_b,
            json={"data_url": "data:image/png;base64,AA=="},
        )
        self.assertEqual(response.status_code, 404, response.get_json())
        for path in (
            f"/api/crm/quotes/{self.ids_a['quote']}/convert-to-invoice",
            f"/api/crm/quotes/{self.ids_a['quote']}/contracts",
            f"/api/crm/public-bookings/{self.ids_a['booking']}/convert",
        ):
            response = self._crm_request("post", path, self.owner_b, json={})
            self.assertEqual(response.status_code, 404, (path, response.get_json()))
        response = self._crm_request(
            "put", f"/api/crm/public-bookings/{self.ids_a['booking']}", self.owner_b,
            json={"status": "closed"},
        )
        self.assertEqual(response.status_code, 404, response.get_json())

    def test_relations_reject_foreign_customer_and_new_records_are_scoped(self):
        foreign_customer_id = self.ids_a["customer"]
        response = self._crm_request(
            "post", "/api/crm/contacts", self.owner_b,
            json={"customer_id": foreign_customer_id, "name": "不該建立"},
        )
        self.assertEqual(response.status_code, 404, response.get_json())

        response = self._crm_request("post", "/api/crm/customers", self.owner_b, json={"name": "乙的新客戶"})
        self.assertEqual(response.status_code, 201, response.get_json())
        from models import Customer
        from extensions import db
        with self.app.app_context():
            created = db.session.get(Customer, response.get_json()["id"])
            self.assertEqual(created.workspace_id, self.owner_b["workspace_id"])

    def test_corrupt_foreign_relations_do_not_leak_even_if_identity_map_is_primed(self):
        from models import Invoice, Quote
        from extensions import db

        headers = {**self.headers(self.owner_a), "X-Test-Prime-Foreign": "1"}
        responses = []
        with self.app.app_context():
            quote = db.session.get(Quote, self.ids_a["quote"])
            quote.contact_id = self.ids_b["contact"]
            db.session.commit()
        responses.append(self.client.get("/api/crm/quotes", headers=headers))

        with self.app.app_context():
            quote = db.session.get(Quote, self.ids_a["quote"])
            quote.contact_id = self.ids_a["contact"]
            quote.customer_id = self.ids_b["customer"]
            db.session.commit()
        responses.append(self.client.get(f"/api/crm/quotes/{self.ids_a['quote']}/pdf", headers=headers))

        with self.app.app_context():
            quote = db.session.get(Quote, self.ids_a["quote"])
            quote.customer_id = self.ids_a["customer"]
            invoice = db.session.get(Invoice, self.ids_a["invoice"])
            invoice.quote_id = self.ids_b["quote"]
            db.session.commit()
        responses.append(self.client.get("/api/crm/invoices?limit=all", headers=headers))
        # A primary-key lookup must issue its workspace predicate even when the foreign
        # identity was loaded earlier in this same request.
        responses.append(self.client.get(f"/api/crm/customers/{self.ids_b['customer']}", headers=headers))

        for response in responses:
            self.assertEqual(response.status_code, 404)
            self.assertNotIn("CRM乙公司", response.get_data(as_text=True))
            self.assertNotIn("客戶B", response.get_data(as_text=True))

    def test_public_booking_without_legacy_workspace_returns_503_without_saving_or_notifying(self):
        from models import WebsiteBooking, Workspace
        from extensions import db
        from routes import crm

        with self.app.app_context():
            self.assertEqual(Workspace.query.filter_by(is_legacy=True).count(), 0)
            before = WebsiteBooking.query.count()
        with patch.object(crm, "send_email_async") as send_email:
            response = self.client.post(
                "/api/crm/public/bookings",
                json={"name": "孤兒名單", "phone": "0900000000", "address": "測試地址"},
            )
        self.assertEqual(response.status_code, 503, response.get_json())
        send_email.assert_not_called()
        with self.app.app_context():
            self.assertEqual(WebsiteBooking.query.count(), before)
            self.assertEqual(WebsiteBooking.query.filter_by(workspace_id=None).count(), 0)

    def test_contract_defaults_use_workspace_brand_and_generic_project_name(self):
        response = self.client.post(
            f"/api/crm/quotes/{self.ids_a['quote']}/contracts",
            headers=self.headers(self.owner_a), json={},
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertEqual(response.get_json()["party_b_name"], "CRM甲公司")
        self.assertIsNone(response.get_json()["party_b_tax_id"])
        self.assertEqual(response.get_json()["project_name"], "客戶A 工程")

    def test_public_booking_ignores_client_workspace_and_stays_legacy(self):
        from routes import crm
        from workspace_helpers import enroll_in_legacy_workspace
        from models import User, WebsiteBooking
        from extensions import db
        with self.app.app_context():
            legacy = enroll_in_legacy_workspace()
            legacy_id = legacy.id
            outsider = User(
                username="crm-not-legacy-admin", role="admin", notification_type="email",
                notification_value="outsider@example.test",
            )
            outsider.set_password("test-password-123")
            db.session.add(outsider)
            db.session.commit()
            with patch.dict(os.environ, {"WEBSITE_LEAD_NOTIFICATION_EMAILS": ""}):
                self.assertNotIn("outsider@example.test", crm._website_lead_notification_recipients())
        response = self.client.post(
            "/api/crm/public/bookings",
            json={"name": "公開名單", "phone": "0900000000", "service": "維修", "address": "測試地址",
                  "workspace_id": self.owner_b["workspace_id"]},
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        with self.app.app_context():
            booking = db.session.get(WebsiteBooking, response.get_json()["booking_id"])
            self.assertEqual(booking.workspace_id, legacy_id)

    def test_document_number_sequences_are_workspace_local(self):
        from flask import g
        from types import SimpleNamespace
        from models import Quote, Invoice, Contract
        from extensions import db
        from routes import crm

        today = date.today()
        quote_prefix = f"QT-{today:%Y%m%d}-"
        invoice_prefix = f"INV-{datetime.utcnow():%Y%m%d}-"
        contract_prefix = f"CT-{today:%Y%m%d}-"
        with self.app.app_context():
            db.session.add_all([
                Quote(workspace_id=self.owner_a["workspace_id"], quote_no=f"{quote_prefix}007", customer_id=self.ids_a["customer"]),
                Invoice(workspace_id=self.owner_a["workspace_id"], invoice_no=f"{invoice_prefix}009", customer_id=self.ids_a["customer"]),
                Contract(
                    workspace_id=self.owner_a["workspace_id"], contract_no=f"{contract_prefix}011",
                    quote_id=self.ids_a["quote"], quote_version_no=1, contract_date=today,
                    project_name="序號範圍測試", party_a_name="甲", party_b_name="乙",
                    payment_terms="測試", quote_snapshot_json="{}",
                ),
            ])
            db.session.commit()
            with self.app.test_request_context("/"):
                g.workspace = SimpleNamespace(id=self.owner_b["workspace_id"])
                self.assertEqual(crm._next_quote_no(today), f"{quote_prefix}001")
                self.assertEqual(crm._next_invoice_no(), f"{invoice_prefix}001")
                self.assertEqual(crm._next_contract_no(today), f"{contract_prefix}001")
