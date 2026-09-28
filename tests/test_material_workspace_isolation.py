"""Materials API tenant isolation against real route handlers."""

from test_workspace_isolation import WorkspaceTestCase


class MaterialsWorkspaceIsolationTest(WorkspaceTestCase):
    def setUp(self):
        super().setUp()
        self.owner_a = self.signup("materials-owner-a", "材料甲公司")
        self.owner_b = self.signup("materials-owner-b", "材料乙公司", industry="cleaning")

    def create_item(self, session, name="測試材料", spec="規格 A"):
        response = self.client.post(
            "/api/materials/items",
            json={"name": name, "spec": spec, "unit": "個", "reference_cost": 12},
            headers=self.headers(session),
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()

    def create_batch(self, session, item_id):
        response = self.client.post(
            "/api/materials/purchases",
            json={
                "supplier_name": "隔離測試供應商",
                "purchase_date": "2026-09-10",
                "items": [{"material_item_id": item_id, "quantity": 8, "unit_cost": 5}],
            },
            headers=self.headers(session),
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()

    def test_catalog_purchase_stock_and_report_are_workspace_scoped(self):
        item_a = self.create_item(self.owner_a)
        batch_a = self.create_batch(self.owner_a, item_a["id"])
        headers_a = self.headers(self.owner_a)
        headers_b = self.headers(self.owner_b)

        self.assertEqual(self.client.get("/api/materials/items", headers=headers_b).get_json(), [])
        self.assertEqual(self.client.get("/api/materials/purchases", headers=headers_b).get_json(), [])
        self.assertEqual(self.client.get("/api/materials/stock/summary", headers=headers_b).get_json()["rows"], [])
        self.assertEqual(self.client.get("/api/materials/stock/transactions", headers=headers_b).get_json()["rows"], [])

        foreign_item = self.client.put(
            f"/api/materials/items/{item_a['id']}", json={"name": "被竄改"}, headers=headers_b
        )
        self.assertEqual(foreign_item.status_code, 404)
        foreign_batch = self.client.get(f"/api/materials/purchases/{batch_a['id']}", headers=headers_b)
        self.assertEqual(foreign_batch.status_code, 404)
        self.assertEqual(
            self.client.put(
                f"/api/materials/purchases/{batch_a['id']}", json={"supplier_name": "被竄改"}, headers=headers_b
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                "/api/materials/purchases",
                json={"supplier_name": "跨租戶", "items": [{"material_item_id": item_a["id"], "quantity": 1}]},
                headers=headers_b,
            ).status_code,
            400,
        )

        stock_a = self.client.get("/api/materials/stock/summary", headers=headers_a).get_json()["rows"]
        self.assertEqual(stock_a[0]["qty_on_hand"], 8)
        report_b = self.client.get("/api/materials/reports/monthly?month=2026-09", headers=headers_b).get_json()
        self.assertEqual(report_b["materials"], [])
        self.assertEqual(report_b["purchase_batches"], [])

    def test_task_usage_checks_task_and_material_workspace(self):
        from models import MaterialStockTransaction, TaskMaterialUsage

        item_a = self.create_item(self.owner_a)
        self.create_batch(self.owner_a, item_a["id"])
        task_a = self.create_task(self.owner_a)
        task_b = self.create_task(self.owner_b, title="乙公司任務")
        headers_a = self.headers(self.owner_a)
        headers_b = self.headers(self.owner_b)

        self.assertEqual(
            self.client.get(f"/api/materials/tasks/{task_a['id']}/usages", headers=headers_b).status_code,
            404,
        )
        foreign_material_usage = self.client.post(
            f"/api/materials/tasks/{task_b['id']}/usages",
            json={"material_item_id": item_a["id"], "used_qty": 1},
            headers=headers_b,
        )
        self.assertEqual(foreign_material_usage.status_code, 404)

        own_usage = self.client.post(
            f"/api/materials/tasks/{task_a['id']}/usages",
            json={"material_item_id": item_a["id"], "used_qty": 1},
            headers=headers_a,
        )
        self.assertEqual(own_usage.status_code, 201, own_usage.get_json())
        foreign_usage_update = self.client.put(
            f"/api/materials/tasks/{task_b['id']}/usages/{own_usage.get_json()['id']}",
            json={"used_qty": 2},
            headers=headers_b,
        )
        self.assertEqual(foreign_usage_update.status_code, 404)
        foreign_usage_delete = self.client.delete(
            f"/api/materials/tasks/{task_b['id']}/usages/{own_usage.get_json()['id']}", headers=headers_b
        )
        self.assertEqual(foreign_usage_delete.status_code, 404)
        with self.app.app_context():
            self.assertEqual(TaskMaterialUsage.query.count(), 1)

    def test_historical_foreign_material_usage_is_hidden_and_cannot_be_updated(self):
        from datetime import date

        from extensions import db
        from models import MaterialStockTransaction, TaskMaterialUsage

        foreign_item = self.create_item(self.owner_a, name="甲公司私有材料", spec="歷史關聯")
        task_b = self.create_task(self.owner_b, title="乙公司歷史任務")
        with self.app.app_context():
            usage = TaskMaterialUsage(
                task_id=task_b["id"],
                material_item_id=foreign_item["id"],
                used_qty=2,
                unit_cost_snapshot=7,
                total_cost=14,
                used_date=date.today(),
            )
            db.session.add(usage)
            db.session.commit()
            usage_id = usage.id

        headers_b = self.headers(self.owner_b)
        listed = self.client.get(f"/api/materials/tasks/{task_b['id']}/usages", headers=headers_b)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.get_json()["rows"], [])
        self.assertNotIn("甲公司私有材料", listed.get_data(as_text=True))

        rejected = self.client.put(
            f"/api/materials/tasks/{task_b['id']}/usages/{usage_id}",
            json={"used_qty": 3},
            headers=headers_b,
        )
        self.assertEqual(rejected.status_code, 404)
        with self.app.app_context():
            self.assertEqual(
                MaterialStockTransaction.query.filter_by(task_material_usage_id=usage_id).count(),
                0,
            )

    def test_purchase_children_with_foreign_material_are_not_serialized(self):
        from extensions import db
        from models import MaterialPurchaseItem

        foreign_item = self.create_item(self.owner_a, name="甲公司採購材料", spec="錯誤關聯")
        local_item = self.create_item(self.owner_b, name="乙公司採購材料", spec="本地")
        batch_b = self.create_batch(self.owner_b, local_item["id"])
        with self.app.app_context():
            db.session.add(
                MaterialPurchaseItem(
                    batch_id=batch_b["id"],
                    material_item_id=foreign_item["id"],
                    quantity=4,
                    unit_cost=9,
                    amount=36,
                    sort_order=1,
                )
            )
            db.session.commit()

        headers_b = self.headers(self.owner_b)
        detail = self.client.get(f"/api/materials/purchases/{batch_b['id']}", headers=headers_b)
        self.assertEqual(detail.status_code, 404)
        self.assertNotIn("甲公司採購材料", detail.get_data(as_text=True))

        listed = self.client.get("/api/materials/purchases", headers=headers_b)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.get_json(), [])
        self.assertNotIn("甲公司採購材料", listed.get_data(as_text=True))

        report = self.client.get("/api/materials/reports/monthly?month=2026-09", headers=headers_b)
        self.assertEqual(report.status_code, 200)
        self.assertEqual(report.get_json()["purchase_batches"], [])
        self.assertNotIn("甲公司採購材料", report.get_data(as_text=True))

    def test_duplicate_catalog_name_is_rejected_within_the_workspace(self):
        self.create_item(self.owner_a, name="同名材料", spec="同規格")
        duplicate = self.client.post(
            "/api/materials/items",
            json={"name": "同名材料", "spec": "同規格"},
            headers=self.headers(self.owner_a),
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_material_manager_routes_still_require_workspace_role(self):
        worker = self.join_new_user(self.owner_a, "materials-worker")
        response = self.client.get("/api/materials/stock/summary", headers=self.headers(worker))
        self.assertEqual(response.status_code, 403)
