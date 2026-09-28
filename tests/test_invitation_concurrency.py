"""Admission regressions. Optional PostgreSQL target must be disposable/local."""

import os
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from test_workspace_isolation import WorkspaceTestCase, PASSWORD, _clear_rate_limits


class InvitationConcurrencyTest(WorkspaceTestCase):
    def setUp(self):
        url = os.environ.get("TASKGO_TEST_DATABASE_URL")
        self.test_engine = None
        if not url:
            super().setUp()
            return
        from sqlalchemy import create_engine
        from sqlalchemy.engine import make_url
        from sqlalchemy.schema import CreateSchema

        parsed = make_url(url)
        if parsed.host not in {"localhost", "127.0.0.1"} or parsed.database != "taskgo_review":
            raise ValueError("Only a local disposable taskgo_review database is allowed")
        _clear_rate_limits()
        self.schema = "invitation_test_" + uuid.uuid4().hex
        self.test_engine = create_engine(parsed)
        with self.test_engine.begin() as connection:
            connection.execute(CreateSchema(self.schema))
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        isolated = parsed.update_query_dict({"options": f"-csearch_path={self.schema}"})
        with patch.dict(os.environ, {
            "DATABASE_URL": isolated.render_as_string(hide_password=False),
            "SECRET_KEY": "test-secret-only-for-local-testing",
            "JWT_SECRET_KEY": "test-jwt-only-for-local-testing-123",
            "INIT_DB_ON_STARTUP": "1", "ALLOW_PUBLIC_SIGNUP": "1",
            "PGSSLMODE": "disable",
            "UPLOAD_FOLDER": str(Path(self.temp_dir.name) / "uploads"),
        }):
            from app import create_app
            self.app = create_app()
        self.client = self.app.test_client()

    def tearDown(self):
        super().tearDown()
        if self.test_engine is not None:
            from sqlalchemy.schema import DropSchema
            with self.test_engine.begin() as connection:
                connection.execute(DropSchema(self.schema, cascade=True))
            self.test_engine.dispose()

    def race(self, calls, boundary="find_usable_invitation"):
        from routes import workspaces
        lookup = getattr(workspaces, boundary)
        barrier = threading.Barrier(len(calls))

        def simultaneous_lookup(code):
            if boundary == "lock_membership_workspace":
                barrier.wait(timeout=10)
                return lookup(code)
            invitation = lookup(code)
            barrier.wait(timeout=10)
            return invitation

        def request(call):
            path, data, headers = call
            with self.app.test_client() as client:
                response = client.post(path, json=data, headers=headers)
                return response.status_code, response.get_json()

        with patch.object(workspaces, boundary, simultaneous_lookup):
            with ThreadPoolExecutor(max_workers=len(calls)) as pool:
                return list(pool.map(request, calls))

    def test_single_use_existing_accounts_race(self):
        owner = self.signup("owner", "Target")
        left = self.signup("left", "Left")
        right = self.signup("right", "Right")
        code = self.invite(owner)
        results = self.race([
            ("/api/workspaces/join", {"code": code}, self.headers(person))
            for person in (left, right)
        ])
        self.assertEqual(sorted(status for status, _ in results), [200, 404], results)
        self.assert_usage_and_members(owner, 1, 2)

    def test_single_use_registration_race_rolls_back_loser(self):
        owner = self.signup("owner", "Target")
        code = self.invite(owner)
        results = self.race([
            ("/api/auth/register", {"username": name, "password": PASSWORD, "invite_code": code}, {})
            for name in ("left", "right")
        ])
        self.assertEqual(sorted(status for status, _ in results), [201, 404], results)
        from models import User
        with self.app.app_context():
            self.assertEqual(User.query.count(), 2)
        self.assert_usage_and_members(owner, 1, 2)

    def test_different_invitations_share_member_limit(self):
        from models import WORKSPACE_PLANS
        owner = self.signup("owner", "Target")
        left = self.signup("left", "Left")
        right = self.signup("right", "Right")
        codes = [self.invite(owner), self.invite(owner)]
        with patch.dict(WORKSPACE_PLANS["trial"], {"max_members": 2}):
            results = self.race([
                ("/api/workspaces/join", {"code": code}, self.headers(person))
                for code, person in zip(codes, (left, right))
            ])
        self.assertEqual(sorted(status for status, _ in results), [200, 403], results)
        self.assertEqual(next(body["code"] for status, body in results if status == 403), "plan_limit")
        self.assert_usage_and_members(owner, 1, 2)

    def assert_usage_and_members(self, owner, used, members):
        from models import WorkspaceInvitation, WorkspaceMember
        with self.app.app_context():
            rows = WorkspaceInvitation.query.filter_by(workspace_id=owner["workspace_id"]).all()
            self.assertEqual(sum(row.used_count for row in rows), used)
            self.assertEqual(WorkspaceMember.query.filter_by(workspace_id=owner["workspace_id"], status="active").count(), members)

    def test_admin_registration_and_invitation_share_member_limit(self):
        from models import WORKSPACE_PLANS, WorkspaceMember
        owner = self.signup("owner", "Target")
        invitee = self.signup("invitee", "Other")
        code = self.invite(owner)
        with patch.dict(WORKSPACE_PLANS["trial"], {"max_members": 2}):
            results = self.race([
                ("/api/auth/register", {"username": "new_staff", "password": PASSWORD, "role": "worker"}, self.headers(owner)),
                ("/api/workspaces/join", {"code": code}, self.headers(invitee)),
            ], boundary="lock_membership_workspace")
        self.assertEqual(sum(status in (200, 201) for status, _ in results), 1, results)
        self.assertEqual(sum(status == 403 for status, _ in results), 1, results)
        with self.app.app_context():
            self.assertEqual(WorkspaceMember.query.filter_by(workspace_id=owner["workspace_id"], status="active").count(), 2)

    def test_revoked_between_lookup_and_redemption(self):
        from datetime import datetime
        from extensions import db
        from models import User
        from routes.workspaces import find_usable_invitation, redeem_invitation, INVITATION_UNAVAILABLE
        owner = self.signup("owner", "Target")
        person = self.signup("joiner", "Other")
        code = self.invite(owner)
        with self.app.app_context():
            invitation = find_usable_invitation(code)
            invitation.revoked_at = datetime.utcnow()
            db.session.commit()
            member, error = redeem_invitation(db.session.get(User, person["user"]["id"]), invitation)
            self.assertIsNone(member)
            self.assertEqual(error, INVITATION_UNAVAILABLE)
            db.session.rollback()
        self.assert_usage_and_members(owner, 0, 1)

    def test_repeated_join_keeps_role_and_does_not_spend_use(self):
        owner = self.signup("owner", "Target")
        code = self.invite(owner, role="worker", max_uses=2)
        result = self.client.post("/api/workspaces/join", json={"code": code}, headers=self.headers(owner))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.get_json()["user"]["role"], "admin")
        self.assert_usage_and_members(owner, 0, 1)
