"""Account deletion with tenant-aware reference cleanup."""

from __future__ import annotations

from sqlalchemy import event

from extensions import db
from models import (
    Attachment,
    AuditLog,
    Contact,
    Contract,
    ContractVersion,
    Customer,
    DeviceToken,
    Invoice,
    InvoiceItem,
    InvoicePaymentRecord,
    MaterialItem,
    MaterialPurchaseBatch,
    MaterialPurchaseItem,
    MaterialStockTransaction,
    Quote,
    QuoteItem,
    QuoteVersion,
    ServiceCatalogItem,
    SiteLocation,
    Task,
    TaskAssignee,
    TaskMaterialUsage,
    TaskUpdate,
    User,
    WebsiteBooking,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMember,
    WorkspaceSetting,
)

_USER_REFERENCE_POLICY = {
    (TaskAssignee, "user_id"): "delete",
    (WorkspaceMember, "user_id"): "delete",
    (DeviceToken, "user_id"): "delete",
    (Task, "assigned_to_id"): "null",
    (Task, "assigned_by_id"): "null",
    (TaskUpdate, "user_id"): "null",
    (Attachment, "uploaded_by_id"): "null",
    (MaterialItem, "created_by_id"): "null",
    (MaterialPurchaseBatch, "created_by_id"): "null",
    (TaskMaterialUsage, "created_by_id"): "null",
    (MaterialStockTransaction, "created_by_id"): "null",
    (Customer, "created_by_id"): "null",
    (WebsiteBooking, "converted_by_id"): "null",
    (Quote, "created_by_id"): "null",
    (QuoteVersion, "changed_by_id"): "null",
    (Contract, "created_by_id"): "null",
    (ContractVersion, "changed_by_id"): "null",
    (Invoice, "created_by_id"): "null",
    (InvoicePaymentRecord, "received_by_id"): "null",
    (AuditLog, "actor_id"): "null",
    (Workspace, "owner_user_id"): "null",
    (WorkspaceInvitation, "invited_by_id"): "null",
}


def _apply_user_reference_policy(user_id: int) -> None:
    actual_references = set()
    for mapper in db.Model.registry.mappers:
        model = mapper.class_
        for column in model.__table__.columns:
            if any(fk.target_fullname == "user.id" for fk in column.foreign_keys):
                actual_references.add((model, column.key))
    unexpected = actual_references - set(_USER_REFERENCE_POLICY)
    stale = set(_USER_REFERENCE_POLICY) - actual_references
    if unexpected or stale:
        details = sorted(f"{model.__tablename__}.{column}" for model, column in unexpected | stale)
        raise RuntimeError("Account deletion user-reference policy is out of date: " + ", ".join(details))

    for (model, name), action in _USER_REFERENCE_POLICY.items():
        column = model.__table__.columns[name]
        query = model.query.filter(column == user_id)
        if action == "delete":
            query.delete(synchronize_session=False)
        else:
            query.update({name: None}, synchronize_session=False)


def _remove_storage_after_commit(paths: set[str]) -> None:
    if not paths:
        return
    try:
        from flask import current_app

        storage = current_app.extensions.get("storage")
    except RuntimeError:
        storage = None
    if storage is None:
        return

    for path in paths:
        try:
            storage.delete(path)
        except Exception:
            try:
                current_app.logger.exception("Failed to remove account-deletion file %s", path)
            except RuntimeError:
                pass


def delete_account(user: User) -> None:
    """Stage account and solely-owned workspace deletion; caller commits.

    Workspace-scoped business data is removed only for workspaces owned by
    this account. User references in retained records are anonymized instead.
    """
    user_id = user.id
    workspaces = Workspace.query.filter_by(owner_user_id=user_id).all()
    workspace_ids = [workspace.id for workspace in workspaces]
    _apply_user_reference_policy(user_id)
    storage_paths: set[str] = set()

    if workspace_ids:
        task_ids = [row[0] for row in db.session.query(Task.id).filter(Task.workspace_id.in_(workspace_ids))]
        for attachment in Attachment.query.filter(Attachment.task_id.in_(task_ids)).all() if task_ids else ():
            storage_paths.add(attachment.file_path)

        invoice_signatures = Invoice.query.filter(Invoice.workspace_id.in_(workspace_ids)).with_entities(
            Invoice.customer_signature_path
        )
        storage_paths.update(path for (path,) in invoice_signatures if path)

        # Remove restrictive and non-cascading CRM references before parents.
        invoice_ids = [row[0] for row in db.session.query(Invoice.id).filter(Invoice.workspace_id.in_(workspace_ids))]
        quote_ids = [row[0] for row in db.session.query(Quote.id).filter(Quote.workspace_id.in_(workspace_ids))]
        contract_ids = [row[0] for row in db.session.query(Contract.id).filter(Contract.workspace_id.in_(workspace_ids))]
        customer_ids = [row[0] for row in db.session.query(Customer.id).filter(Customer.workspace_id.in_(workspace_ids))]
        contact_ids = [row[0] for row in db.session.query(Contact.id).filter(Contact.workspace_id.in_(workspace_ids))]

        for model, column, ids in (
            (InvoicePaymentRecord, InvoicePaymentRecord.invoice_id, invoice_ids),
            (InvoiceItem, InvoiceItem.invoice_id, invoice_ids),
            (ContractVersion, ContractVersion.contract_id, contract_ids),
            (QuoteVersion, QuoteVersion.quote_id, quote_ids),
            (QuoteItem, QuoteItem.quote_id, quote_ids),
        ):
            if ids:
                db.session.query(model).filter(column.in_(ids)).delete(synchronize_session=False)

        for model in (Invoice, Contract, Quote):
            model.query.filter(model.workspace_id.in_(workspace_ids)).delete(synchronize_session=False)

        WebsiteBooking.query.filter(WebsiteBooking.workspace_id.in_(workspace_ids)).delete(
            synchronize_session=False
        )
        if contact_ids:
            Contact.query.filter(Contact.id.in_(contact_ids)).delete(synchronize_session=False)
        if customer_ids:
            Customer.query.filter(Customer.id.in_(customer_ids)).delete(synchronize_session=False)

        # Material stock entries can reference both usages and purchase items.
        usage_ids = [row[0] for row in db.session.query(TaskMaterialUsage.id).filter(TaskMaterialUsage.task_id.in_(task_ids))] if task_ids else []
        batch_ids = [row[0] for row in db.session.query(MaterialPurchaseBatch.id).filter(MaterialPurchaseBatch.workspace_id.in_(workspace_ids))]
        purchase_item_ids = [row[0] for row in db.session.query(MaterialPurchaseItem.id).filter(MaterialPurchaseItem.batch_id.in_(batch_ids))] if batch_ids else []
        material_ids = [row[0] for row in db.session.query(MaterialItem.id).filter(MaterialItem.workspace_id.in_(workspace_ids))]
        MaterialStockTransaction.query.filter(
            MaterialStockTransaction.workspace_id.in_(workspace_ids)
        ).delete(synchronize_session=False)
        if usage_ids:
            TaskMaterialUsage.query.filter(TaskMaterialUsage.id.in_(usage_ids)).delete(synchronize_session=False)
        if purchase_item_ids:
            MaterialPurchaseItem.query.filter(MaterialPurchaseItem.id.in_(purchase_item_ids)).delete(synchronize_session=False)
        if batch_ids:
            MaterialPurchaseBatch.query.filter(MaterialPurchaseBatch.id.in_(batch_ids)).delete(synchronize_session=False)
        if material_ids:
            MaterialItem.query.filter(MaterialItem.id.in_(material_ids)).delete(synchronize_session=False)

        # Tasks own attachments, updates, and assignments through ORM cascades.
        for task in Task.query.filter(Task.workspace_id.in_(workspace_ids)).all():
            db.session.delete(task)

        # Keep the deletion policy explicit; new tables require review.
        for model in (AuditLog, SiteLocation, ServiceCatalogItem, WorkspaceInvitation, WorkspaceSetting, WorkspaceMember):
            model.query.filter(model.workspace_id.in_(workspace_ids)).delete(synchronize_session=False)

        Workspace.query.filter(Workspace.id.in_(workspace_ids)).delete(synchronize_session=False)

    db.session.delete(user)
    db.session.info.setdefault("account_deletion_storage_paths", set()).update(storage_paths)
    session = db.session()

    def cleanup_after_commit(committed_session):
        paths = committed_session.info.pop("account_deletion_storage_paths", set())
        _remove_storage_after_commit(paths)

    def clear_storage_after_rollback(rolled_back_session):
        rolled_back_session.info.pop("account_deletion_storage_paths", None)

    event.listen(session, "after_commit", cleanup_after_commit, once=True)
    event.listen(session, "after_rollback", clear_storage_after_rollback, once=True)
