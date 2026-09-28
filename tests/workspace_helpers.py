"""Fixtures helpers for the workspace (multi-tenant) model."""

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from extensions import db  # noqa: E402
from models import User, Workspace, WorkspaceMember  # noqa: E402


def enroll_in_legacy_workspace(name: str = "立翔水電行") -> Workspace:
    """Mirror the production migration for fixtures built with global roles.

    Every existing account joins one legacy company with its ``user.role`` and
    every tenant row without a company is assigned to it.
    """
    workspace = Workspace.query.filter_by(is_legacy=True).first()
    if workspace is None:
        admin = User.query.filter_by(role="admin").order_by(User.id).first()
        workspace = Workspace(
            name=name,
            slug="legacy",
            plan="legacy",
            is_legacy=True,
            owner_user_id=admin.id if admin else None,
        )
        db.session.add(workspace)
        db.session.flush()
    for user in User.query.all():
        if not WorkspaceMember.query.filter_by(workspace_id=workspace.id, user_id=user.id).first():
            db.session.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=user.role))
    for mapper in db.Model.registry.mappers:
        model = mapper.class_
        if model in (WorkspaceMember,) or not hasattr(model, "workspace_id"):
            continue
        if getattr(model, "__tablename__", None) in {"workspace_invitation", "workspace_setting"}:
            continue
        model.query.filter(model.workspace_id.is_(None)).update(
            {"workspace_id": workspace.id}, synchronize_session=False
        )
    db.session.commit()
    return workspace
