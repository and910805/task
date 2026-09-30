from datetime import date
from pathlib import Path
from unittest.mock import patch

from test_workspace_isolation import WorkspaceTestCase


class StampEditorTest(WorkspaceTestCase):
    def setUp(self):
        super().setUp()
        from extensions import db
        from models import Customer, Quote, QuoteItem, WorkspaceSetting
        self.owner = self.signup("stamp-owner", "Stamp company")
        self.other = self.signup("stamp-other", "Other company")
        with self.app.app_context():
            customer = Customer(workspace_id=self.owner["workspace_id"], name="Sample customer")
            db.session.add(customer)
            db.session.flush()
            quote = Quote(workspace_id=customer.workspace_id, quote_no="QT-TEST-STAMP",
                          customer_id=customer.id, issue_date=date(2026, 9, 30),
                          subtotal=16000, tax_rate=5, tax_amount=800, total_amount=16800)
            db.session.add(quote)
            db.session.flush()
            db.session.add_all([QuoteItem(quote_id=quote.id, description="Electrical installation",
                                         unit="set", quantity=1, unit_price=1000, amount=1000,
                                         sort_order=i) for i in range(16)])
            self.quote_id = quote.id
            WorkspaceSetting.set_value(customer.workspace_id, "pdf_stamp_path",
                str(Path(__file__).resolve().parents[1] / "data" / "S__5505135-removebg-preview.png"))
            db.session.commit()
        self.base = f"/api/crm/quotes/{self.quote_id}"
        from routes import crm
        for target, kwargs in (("_require_embedded_pdf_font", {}), ("PDF_FONT_NAME", {"new": "Helvetica"}),
                               ("_resolve_pdf_stamp_rotation_deg", {"return_value": 90})):
            p = patch.object(crm, target, **kwargs)
            p.start()
            self.addCleanup(p.stop)

    def preview(self):
        response = self.client.get(self.base + "/stamp-preview", headers=self.headers(self.owner))
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()

    def safe_position(self, preview):
        rows = preview["rows"][-3:]
        return {"mode": "manual", "page": preview["page"], "fingerprint": preview["fingerprint"],
                "x": (rows[0]["cells"][5]["box"][0] + rows[0]["cells"][-1]["box"][2]) / 2,
                "y": (rows[0]["cells"][0]["box"][3] + rows[-1]["cells"][0]["box"][1]) / 2}

    def put(self, data):
        return self.client.put(self.base + "/stamp-position", json=data, headers=self.headers(self.owner))

    def test_preview_save_download_reset_and_stale_content(self):
        preview = self.preview()
        self.assertEqual(preview["pages"], 1)
        self.assertTrue(preview["image"].startswith("iVBOR"))
        from services.pdf_stamp_layout import validate_position
        validate_position({"page": 1, "x": preview["automatic"]["center_x"],
                           "y": preview["automatic"]["center_y"], "fingerprint": preview["fingerprint"]}, preview)
        position = self.safe_position(preview)
        response = self.put(position)
        self.assertEqual(response.status_code, 200, response.get_json())
        saved = self.preview()["saved"]
        self.assertEqual(saved["x"], position["x"])
        from routes import crm
        with patch.object(crm, "_draw_pdf_stamp", wraps=crm._draw_pdf_stamp) as draw:
            response = self.client.get(self.base + "/pdf", headers=self.headers(self.owner))
            placement = draw.call_args.args[2]
            self.assertEqual(placement["center_x"], position["x"])
            self.assertEqual(placement["center_y"], position["y"])
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data.startswith(b"%PDF"))
        from extensions import db
        from models import QuoteItem
        with self.app.app_context():
            item = QuoteItem.query.filter_by(quote_id=self.quote_id).first()
            item.description = "Changed layout " * 12
            db.session.commit()
        self.assertEqual(self.put(position).status_code, 409)
        self.assertTrue(self.preview()["warning"])
        self.assertEqual(self.client.get(self.base + "/pdf", headers=self.headers(self.owner)).status_code, 409)
        self.assertEqual(self.put({"mode": "auto"}).status_code, 200)
        self.assertIsNone(self.preview()["saved"])
        self.assertEqual(self.client.get(self.base + "/pdf", headers=self.headers(self.owner)).status_code, 200)

    def test_reject_overlap_outside_invalid_input_and_other_workspace(self):
        preview = self.preview()
        valid = self.safe_position(preview)
        for values in ({"x": 0}, {"y": 800}, {"page": 999}, {"x": float("nan")},
                       {"x": "123"}, {"page": True}, {"fingerprint": "old"},
                       {"y": preview["rows"][0]["cells"][5]["box"][1]}):
            response = self.put({**valid, **values})
            self.assertEqual(response.status_code, 409, values)
        for method, endpoint in (("get", "/stamp-preview"), ("put", "/stamp-position")):
            response = getattr(self.client, method)(self.base + endpoint, headers=self.headers(self.other),
                                                    **({"json": valid} if method == "put" else {}))
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.put([]).status_code, 400)

    def test_converted_quote_and_signed_invoice_are_locked(self):
        from extensions import db
        from models import Invoice, Quote
        from datetime import datetime
        with self.app.app_context():
            quote = db.session.get(Quote, self.quote_id)
            invoice = Invoice(workspace_id=quote.workspace_id, customer_id=quote.customer_id,
                              quote_id=quote.id, invoice_no="INV-STAMP", customer_signed_at=datetime.utcnow())
            db.session.add(invoice)
            db.session.commit()
            invoice_id = invoice.id
        self.assertEqual(self.put({"mode": "auto"}).status_code, 409)
        response = self.client.put(f"/api/crm/invoices/{invoice_id}/stamp-position",
                                   json={"mode": "auto"}, headers=self.headers(self.owner))
        self.assertEqual(response.status_code, 409)

    def test_unsigned_invoice_can_preview_and_save_separately(self):
        response = self.client.post(self.base + "/convert-to-invoice", headers=self.headers(self.owner))
        self.assertEqual(response.status_code, 201, response.get_json())
        invoice_id = response.get_json()["invoice"]["id"]
        path = f"/api/crm/invoices/{invoice_id}"
        response = self.client.get(path + "/stamp-preview", headers=self.headers(self.owner))
        self.assertEqual(response.status_code, 200, response.get_json())
        position = self.safe_position(response.get_json())
        response = self.client.put(path + "/stamp-position", json=position, headers=self.headers(self.owner))
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.client.get(path + "/pdf", headers=self.headers(self.owner)).status_code, 200)
        self.assertIsNone(self.preview()["saved"])

    def test_multiple_pages_use_actual_fragment_positions(self):
        from extensions import db
        from models import QuoteItem
        with self.app.app_context():
            db.session.add_all([QuoteItem(quote_id=self.quote_id, description="More items",
                                         unit="set", quantity=1, unit_price=100, amount=100,
                                         sort_order=i) for i in range(16, 35)])
            db.session.commit()
        first = self.preview()
        self.assertGreater(first["pages"], 1)
        response = self.client.get(self.base + "/stamp-preview", query_string={"page": first["pages"]},
                                   headers=self.headers(self.owner))
        self.assertEqual(response.status_code, 200)
        last = response.get_json()
        self.assertEqual(last["fingerprint"], first["fingerprint"])
        position = {"mode": "manual", "page": last["automatic"]["target_page"],
                    "x": last["automatic"]["center_x"], "y": last["automatic"]["center_y"],
                    "fingerprint": last["fingerprint"]}
        response = self.put(position)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.client.get(self.base + "/pdf", headers=self.headers(self.owner)).status_code, 200)
