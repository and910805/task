"""Foreign-key and tenant-isolation coverage for account deletion."""

import sys
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import event

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from extensions import db  # noqa: E402
from models import (  # noqa: E402
    Attachment,
    Contact,
    Contract,
    Customer,
    DeviceToken,
    Invoice,
    MaterialItem,
    MaterialPurchaseBatch,
    MaterialPurchaseItem,
    MaterialStockTransaction,
    Quote,
    Task,
    TaskAssignee,
    TaskMaterialUsage,
    User,
    WebsiteBooking,
    Workspace,
)
from test_workspace_isolation import PASSWORD, WorkspaceTestCase  # noqa: E402


class AccountDeletionIntegrityTest(WorkspaceTestCase):
    def setUp(self):
        super().setUp()

        with self.app.app_context():
            if db.engine.dialect.name != "sqlite":
                return
            @event.listens_for(db.engine, "connect")
            def enable_foreign_keys(connection, record):
                cursor = connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

            db.engine.dispose()
            with db.engine.connect() as connection:
                self.assertEqual(connection.exec_driver_sql("PRAGMA foreign_keys").scalar(), 1)

    def test_member_self_delete_anonymizes_creator_and_preserves_other_tenants(self):
        owner = self.signup("delete-owner", "刪除測試公司")
        staff = self.join_new_user(owner, "delete-staff", role="hq_staff")
        unrelated_owner = self.signup("unrelated-owner", "保留公司", industry="cleaning")
        unrelated_task = self.create_task(unrelated_owner, title="不可刪除")

        with self.app.app_context():
            retained_task = Task(
                workspace_id=owner["workspace_id"],
                title="保留工單",
                description="保留歷史但移除人員參照",
                location="公司內",
                expected_time=datetime.utcnow(),
                assigned_to_id=staff["user"]["id"],
                assigned_by_id=staff["user"]["id"],
            )
            db.session.add(retained_task)
            db.session.flush()
            db.session.add(TaskAssignee(task_id=retained_task.id, user_id=staff["user"]["id"]))
            db.session.add(
                DeviceToken(user_id=staff["user"]["id"], platform="ios", token="delete-account-token")
            )
            customer = Customer(
                workspace_id=owner["workspace_id"],
                name="歷史客戶",
                created_by_id=staff["user"]["id"],
            )
            db.session.add(customer)
            db.session.commit()
            customer_id, retained_task_id = customer.id, retained_task.id

        response = self.client.delete(
            "/api/auth/account",
            headers=self.headers(staff),
            json={"password": PASSWORD},
        )
        self.assertEqual(response.status_code, 200, response.get_json())

        with self.app.app_context():
            self.assertIsNone(db.session.get(User, staff["user"]["id"]))
            retained_customer = db.session.get(Customer, customer_id)
            self.assertIsNotNone(retained_customer)
            self.assertIsNone(retained_customer.created_by_id)
            retained_task = db.session.get(Task, retained_task_id)
            self.assertIsNotNone(retained_task)
            self.assertIsNone(retained_task.assigned_to_id)
            self.assertIsNone(retained_task.assigned_by_id)
            self.assertEqual(TaskAssignee.query.filter_by(user_id=staff["user"]["id"]).count(), 0)
            self.assertEqual(DeviceToken.query.filter_by(user_id=staff["user"]["id"]).count(), 0)
            retained_task = db.session.get(Task, unrelated_task["id"])
            self.assertIsNotNone(retained_task)
            self.assertEqual(retained_task.workspace_id, unrelated_owner["workspace_id"])

    def test_owned_workspace_crm_materials_and_files_are_removed_after_commit(self):
        owner = self.signup("delete-workspace-owner", "完整刪除公司")
        with self.app.app_context():
            workspace = db.session.get(Workspace, owner["workspace_id"])
            customer = Customer(workspace_id=workspace.id, name="整家公司客戶", created_by_id=workspace.owner_user_id)
            db.session.add(customer)
            db.session.flush()
            contact = Contact(workspace_id=workspace.id, customer_id=customer.id, name="聯絡人")
            db.session.add(contact)
            db.session.flush()
            quote = Quote(
                workspace_id=workspace.id,
                quote_no="DEL-Q-1",
                customer_id=customer.id,
                contact_id=contact.id,
                created_by_id=workspace.owner_user_id,
            )
            db.session.add(quote)
            db.session.flush()
            contract = Contract(
                workspace_id=workspace.id,
                contract_no="DEL-C-1",
                quote_id=quote.id,
                quote_version_no=1,
                contract_date=date.today(),
                project_name="刪除測試工程",
                party_a_name="甲方",
                party_b_name="乙方",
                payment_terms="測試",
                quote_snapshot_json="{}",
            )
            invoice = Invoice(
                workspace_id=workspace.id,
                invoice_no="DEL-I-1",
                customer_id=customer.id,
                contact_id=contact.id,
                quote_id=quote.id,
                created_by_id=workspace.owner_user_id,
            )
            task = Task(
                workspace_id=workspace.id,
                title="有附件的任務",
                description="測試刪除",
                location="測試地點",
                expected_time=datetime.utcnow(),
                assigned_by_id=workspace.owner_user_id,
            )
            material = MaterialItem(workspace_id=workspace.id, name="測試材料")
            batch = MaterialPurchaseBatch(
                workspace_id=workspace.id,
                supplier_name="供應商",
                purchase_date=date.today(),
                statement_month=date.today().strftime("%Y-%m"),
                created_by_id=workspace.owner_user_id,
            )
            booking = WebsiteBooking(
                workspace_id=workspace.id,
                name="沒有客戶關聯的預約",
                phone="0900000000",
                service="檢查水管",
            )
            db.session.add_all([contract, invoice, task, material, batch, booking])
            db.session.flush()
            purchase_item = MaterialPurchaseItem(batch_id=batch.id, material_item_id=material.id)
            usage = TaskMaterialUsage(task_id=task.id, material_item_id=material.id)
            db.session.add_all([purchase_item, usage])
            db.session.flush()
            stock = MaterialStockTransaction(
                workspace_id=workspace.id,
                material_item_id=material.id,
                txn_type="adjustment",
                purchase_item_id=purchase_item.id,
            )
            db.session.add(stock)
            attachment = Attachment(task_id=task.id, file_type="image", file_path="account-delete/test.png")
            db.session.add(attachment)
            storage = self.app.extensions["storage"]
            storage.save(attachment.file_path, b"temporary test file")
            owner_user = db.session.get(User, workspace.owner_user_id)
            user_id, workspace_id = owner_user.id, workspace.id
            db.session.commit()

            from services.account_deletion import delete_account

            delete_account(db.session.get(User, user_id))
            self.assertTrue(storage.local_path("account-delete/test.png").exists())
            db.session.commit()

            self.assertIsNone(db.session.get(User, user_id))
            self.assertIsNone(db.session.get(Workspace, workspace_id))
            self.assertFalse((storage.base_dir / "account-delete/test.png").exists())
            for model in (
                Customer, Contact, Quote, Contract, Invoice, MaterialItem,
                MaterialPurchaseBatch, Task, WebsiteBooking,
            ):
                self.assertEqual(model.query.filter_by(workspace_id=workspace_id).count(), 0, model.__name__)

    def test_rollback_does_not_remove_files(self):
        owner = self.signup("delete-rollback-owner", "回滾保留公司")
        with self.app.app_context():
            workspace = db.session.get(Workspace, owner["workspace_id"])
            task = Task(
                workspace_id=workspace.id,
                title="保留檔案",
                description="回滾測試",
                location="測試地點",
                expected_time=datetime.utcnow(),
            )
            db.session.add(task)
            db.session.flush()
            attachment = Attachment(task_id=task.id, file_type="image", file_path="account-delete/rollback.png")
            db.session.add(attachment)
            storage = self.app.extensions["storage"]
            storage.save(attachment.file_path, b"must survive rollback")
            user = db.session.get(User, workspace.owner_user_id)
            db.session.commit()

            from services.account_deletion import delete_account

            delete_account(user)
            db.session.rollback()
            self.assertTrue(storage.local_path("account-delete/rollback.png").exists())
            self.assertIsNotNone(db.session.get(User, user.id))
            db.session.add(Customer(name="回滾後仍可提交"))
            db.session.commit()
            self.assertTrue(storage.local_path("account-delete/rollback.png").exists())
