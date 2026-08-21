import asyncio
import os
from collections import Counter
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import psycopg
import pytest
from fastapi import Request
from fastapi.routing import APIRoute

import backend.identity.router as identity_router_module
import backend.kiosk.router as kiosk_router_module
from backend.attendance.repository import AttendanceRepository
from backend.core.auth import get_current_user
from backend.core.clock import FrozenClock
from backend.core.db import application_transaction, get_database_connection
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.repository import StaffMemberRecord, TeacherApplicationRecord
from backend.identity.router import (
    get_identity_repository,
    get_staff_service,
    require_admin,
)
from backend.identity.schemas import StaffRole, TeacherApplicationStatus
from backend.kiosk.repository import KioskRepository, ManagedKioskSessionRecord
from backend.kiosk.router import get_kiosk_service
from backend.kiosk.security import KioskPasswordHasher
from backend.kiosk.service import KioskSessionRevoked, KioskSessionService
from backend.main import app

ADMIN_OPERATIONS = {
    ("GET", "/api/admin/teacher-applications"),
    ("POST", "/api/admin/teacher-applications/{application_id}/approve"),
    ("POST", "/api/admin/teacher-applications/{application_id}/reject"),
    ("GET", "/api/admin/staff"),
    ("PATCH", "/api/admin/staff/{user_id}/role"),
    ("GET", "/api/admin/kiosk-sessions"),
    ("DELETE", "/api/admin/kiosk-sessions/{session_id}"),
}


def _registered_operations(router: object) -> Counter[tuple[str, str]]:
    operations: Counter[tuple[str, str]] = Counter()
    for route in getattr(router, "routes", []):
        original_router = getattr(route, "original_router", None)
        if original_router is not None:
            operations.update(_registered_operations(original_router))
            continue
        path = getattr(route, "path", "")
        for method in getattr(route, "methods", set()):
            operation = (method, path)
            if operation in ADMIN_OPERATIONS:
                operations[operation] += 1
    return operations


def _module_operations(module: object) -> Counter[tuple[str, str]]:
    operations: Counter[tuple[str, str]] = Counter()
    for value in vars(module).values():
        if hasattr(value, "routes"):
            operations.update(_registered_operations(value))
    return operations


def test_admin_operations_are_registered_exactly_once_only_on_admin_router() -> None:
    from backend.admin.router import router as admin_router

    assert _registered_operations(admin_router) == Counter(
        {operation: 1 for operation in ADMIN_OPERATIONS}
    )
    assert _module_operations(identity_router_module) == Counter()
    assert _module_operations(kiosk_router_module) == Counter()
    assert _registered_operations(app) == Counter(
        {operation: 1 for operation in ADMIN_OPERATIONS}
    )


def test_every_admin_operation_directly_requires_function_scoped_admin() -> None:
    from backend.admin.router import router as admin_router

    matching_routes = [
        route
        for route in admin_router.routes
        if isinstance(route, APIRoute)
        and any((method, route.path) in ADMIN_OPERATIONS for method in route.methods)
    ]

    assert len(matching_routes) == len(ADMIN_OPERATIONS)
    for route in matching_routes:
        direct_admin_dependencies = [
            dependency
            for dependency in route.dependant.dependencies
            if dependency.call is require_admin
        ]
        assert len(direct_admin_dependencies) == 1
        assert direct_admin_dependencies[0].scope == "function"


class FakeIdentityRepository:
    def __init__(self, role: StaffRole | None) -> None:
        self.role = role

    async def bootstrap_initial_admin(self, _user: AuthenticatedUser) -> bool:
        return False

    async def staff_role(self, _user_id: UUID) -> StaffRole | None:
        return self.role


class FakeStaffService:
    def __init__(self) -> None:
        self.application_id = uuid4()
        self.staff_id = uuid4()
        self.decisions: list[tuple[UUID, UUID, str, str | None]] = []
        self.role_changes: list[tuple[UUID, UUID, str]] = []

    async def pending_applications(self) -> list[TeacherApplicationRecord]:
        return [
            TeacherApplicationRecord(
                id=self.application_id,
                user_id=uuid4(),
                email="teacher@example.com",
                name="김교사",
                phone="01011112222",
                status=TeacherApplicationStatus.PENDING,
                rejection_reason=None,
            )
        ]

    async def decide_application(
        self,
        actor_id: UUID,
        application_id: UUID,
        *,
        decision: str,
        rejection_reason: str | None = None,
    ) -> TeacherApplicationRecord:
        self.decisions.append(
            (actor_id, application_id, decision, rejection_reason)
        )
        return TeacherApplicationRecord(
            id=application_id,
            user_id=uuid4(),
            email="teacher@example.com",
            name="김교사",
            phone="01011112222",
            status=TeacherApplicationStatus(decision),
            rejection_reason=rejection_reason,
        )

    async def staff_members(self) -> list[StaffMemberRecord]:
        return [
            StaffMemberRecord(
                user_id=self.staff_id,
                email="staff@example.com",
                name="박교사",
                phone=None,
                role=StaffRole.TEACHER,
            )
        ]

    async def set_role(
        self, actor_id: UUID, target_user_id: UUID, role: str
    ) -> StaffMemberRecord:
        self.role_changes.append((actor_id, target_user_id, role))
        return StaffMemberRecord(
            user_id=target_user_id,
            email="staff@example.com",
            name="박교사",
            phone=None,
            role=StaffRole(role),
        )


class FakeKioskService:
    def __init__(self) -> None:
        now = datetime(2026, 8, 22, 3, tzinfo=UTC)
        self.session = ManagedKioskSessionRecord(
            session_id=uuid4(),
            created_at=now - timedelta(days=2),
            last_seen_at=now - timedelta(minutes=5),
            refresh_expires_at=now + timedelta(days=20),
            revoked_at=None,
        )
        self.revocations: list[tuple[UUID, UUID]] = []

    async def admin_sessions(self) -> list[ManagedKioskSessionRecord]:
        return [self.session]

    async def revoke_as_admin(self, session_id: UUID, actor_id: UUID) -> None:
        self.revocations.append((session_id, actor_id))


@pytest.fixture
def admin_user() -> AuthenticatedUser:
    return AuthenticatedUser(
        user_id=uuid4(),
        email="admin@example.com",
        provider="google",
        email_verified=True,
    )


async def test_anonymous_admin_requests_return_stable_auth_required(
    client: httpx.AsyncClient,
) -> None:
    for method, path in [
        ("GET", "/api/admin/teacher-applications"),
        ("GET", "/api/admin/staff"),
        ("GET", "/api/admin/kiosk-sessions"),
    ]:
        response = await client.request(method, path)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTH_REQUIRED"


@pytest.mark.parametrize(
    ("provider", "role"),
    [("password", StaffRole.ADMIN), ("google", StaffRole.TEACHER)],
)
async def test_non_google_and_non_admin_receive_stable_forbidden(
    client: httpx.AsyncClient,
    provider: str,
    role: StaffRole,
) -> None:
    user = AuthenticatedUser(
        user_id=uuid4(),
        email="staff@example.com",
        provider=provider,
        email_verified=True,
    )

    async def current_user() -> AuthenticatedUser:
        return user

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_identity_repository] = lambda: FakeIdentityRepository(
        role
    )
    try:
        response = await client.get("/api/admin/staff")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


async def test_admin_routes_delegate_and_gets_are_no_store(
    client: httpx.AsyncClient,
    admin_user: AuthenticatedUser,
) -> None:
    staff_service = FakeStaffService()
    kiosk_service = FakeKioskService()

    async def current_admin() -> AuthenticatedUser:
        return admin_user

    app.dependency_overrides[require_admin] = current_admin
    app.dependency_overrides[get_staff_service] = lambda: staff_service
    app.dependency_overrides[get_kiosk_service] = lambda: kiosk_service
    try:
        applications = await client.get("/api/admin/teacher-applications")
        approved = await client.post(
            f"/api/admin/teacher-applications/{staff_service.application_id}/approve",
            json={},
        )
        rejected = await client.post(
            f"/api/admin/teacher-applications/{staff_service.application_id}/reject",
            json={"rejection_reason": " 정보 확인 필요 "},
        )
        staff = await client.get("/api/admin/staff")
        promoted = await client.patch(
            f"/api/admin/staff/{staff_service.staff_id}/role",
            json={"role": "admin"},
        )
        kiosks = await client.get("/api/admin/kiosk-sessions")
        revoked = await client.delete(
            f"/api/admin/kiosk-sessions/{kiosk_service.session.session_id}"
        )
    finally:
        app.dependency_overrides.clear()

    assert [response.status_code for response in (applications, staff, kiosks)] == [
        200,
        200,
        200,
    ]
    assert all(
        response.headers["Cache-Control"] == "no-store"
        for response in (applications, staff, kiosks)
    )
    assert approved.json()["status"] == "approved"
    assert rejected.json()["status"] == "rejected"
    assert promoted.json()["role"] == "admin"
    assert revoked.status_code == 204
    assert staff_service.decisions == [
        (admin_user.user_id, staff_service.application_id, "approved", None),
        (
            admin_user.user_id,
            staff_service.application_id,
            "rejected",
            "정보 확인 필요",
        ),
    ]
    assert kiosk_service.revocations == [
        (kiosk_service.session.session_id, admin_user.user_id)
    ]
    assert set(kiosks.json()[0]) == {
        "session_id",
        "created_at",
        "last_seen_at",
        "refresh_expires_at",
        "revoked_at",
    }


async def test_admin_mutation_dependency_commit_failure_precedes_success_response(
    client: httpx.AsyncClient,
    admin_user: AuthenticatedUser,
) -> None:
    service = FakeStaffService()

    async def current_admin() -> AuthenticatedUser:
        return admin_user

    async def failing_transaction_service():
        yield service
        raise ApiError("DATABASE_UNAVAILABLE", "잠시 후 다시 시도해 주세요.", 503)

    app.dependency_overrides[require_admin] = current_admin
    app.dependency_overrides[get_staff_service] = failing_transaction_service
    try:
        response = await client.post(
            f"/api/admin/teacher-applications/{service.application_id}/approve",
            json={},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert len(service.decisions) == 1


def test_identity_and_kiosk_repositories_share_cached_database_dependency() -> None:
    identity_dependency = next(
        dependency
        for dependency in get_identity_repository.__annotations__.values()
        if hasattr(dependency, "__metadata__")
    )
    kiosk_dependency = next(
        dependency
        for dependency in kiosk_router_module.get_kiosk_repository.__annotations__.values()
        if hasattr(dependency, "__metadata__")
    )

    identity_marker = identity_dependency.__metadata__[0]
    kiosk_marker = kiosk_dependency.__metadata__[0]
    assert identity_marker.dependency is get_database_connection
    assert kiosk_marker.dependency is get_database_connection
    assert identity_marker.scope == kiosk_marker.scope == "function"
    assert identity_marker.use_cache is kiosk_marker.use_cache is True


async def test_live_kiosk_admin_list_and_idempotent_revoke_are_redacted_and_immediate() -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for kiosk administration integration")

    actor_id = uuid4()
    session_ids = [uuid4(), uuid4(), uuid4()]
    older_session_ids = [uuid4() for _ in range(100)]
    all_session_ids = session_ids + older_session_ids
    now = datetime(2026, 8, 22, 3, tzinfo=UTC)
    clock = FrozenClock(now)
    password_hash = KioskPasswordHasher().hash("church-kiosk-secret")
    cookie_secret = "c" * 64
    qr_secret = "q" * 64

    with psycopg.connect(database_url) as owner:
        owner.execute("insert into auth.users (id) values (%s)", (actor_id,))
        owner.execute(
            """
            insert into app.user_profiles (user_id, email, name)
            values (%s, %s, %s)
            """,
            (actor_id, f"admin-{actor_id.hex}@example.com", "관리자"),
        )
        with owner.cursor() as cursor:
            cursor.executemany(
                """
                insert into app.kiosk_sessions (
                  id, refresh_token_hash, created_at, last_seen_at,
                  refresh_expires_at, revoked_at
                ) values (%s, %s, %s, %s, %s, %s)
                """,
                [
                (
                    session_ids[0],
                    "active-secret-hash",
                    now - timedelta(days=3),
                    now - timedelta(minutes=1),
                    now + timedelta(days=1),
                    None,
                ),
                (
                    session_ids[1],
                    "expired-secret-hash",
                    now - timedelta(days=4),
                    now - timedelta(minutes=2),
                    now - timedelta(seconds=1),
                    None,
                ),
                (
                    session_ids[2],
                    "revoked-secret-hash",
                    now - timedelta(days=5),
                    now - timedelta(minutes=3),
                    now + timedelta(days=2),
                    now - timedelta(minutes=2),
                ),
                ],
            )
            cursor.executemany(
                """
                insert into app.kiosk_sessions (
                  id, refresh_token_hash, created_at, last_seen_at,
                  refresh_expires_at
                ) values (%s, %s, %s, %s, %s)
                """,
                [
                    (
                        session_id,
                        f"older-secret-hash-{index}",
                        now - timedelta(days=10 + index),
                        now - timedelta(minutes=10 + index),
                        now + timedelta(days=1),
                    )
                    for index, session_id in enumerate(older_session_ids)
                ],
            )

    try:
        async with application_transaction(database_url=database_url) as connection:
            service = KioskSessionService(
                KioskRepository(connection),
                password_hash=password_hash,
                cookie_secret=cookie_secret,
                qr_signing_secret=qr_secret,
                clock=clock,
            )
            access_token, _ = service._access_tokens.issue(session_ids[0])
            issued_qr = service.issue_qr_challenge(session_ids[0]).token

            listed = await service.admin_sessions()
            assert [item.session_id for item in listed[:3]] == session_ids
            assert len(listed) == 100
            assert set(listed[0].__dict__) == {
                "session_id",
                "created_at",
                "last_seen_at",
                "refresh_expires_at",
                "revoked_at",
            }

            await service.revoke_as_admin(session_ids[0], actor_id)
            first_state = await connection.execute(
                "select revoked_at, last_seen_at from app.kiosk_sessions where id = %s",
                (session_ids[0],),
            )
            first_timestamps = await first_state.fetchone()
            await service.revoke_as_admin(session_ids[0], actor_id)
            repeated_state = await connection.execute(
                "select revoked_at, last_seen_at from app.kiosk_sessions where id = %s",
                (session_ids[0],),
            )
            assert await repeated_state.fetchone() == first_timestamps

            with pytest.raises(KioskSessionRevoked):
                await service.require_access(access_token)
            with pytest.raises(KioskSessionRevoked):
                await service.verify_qr_challenge(issued_qr)

            audits = await connection.execute(
                """
                select details
                from app.audit_logs
                where action = 'kiosk.session_revoked' and target_id = %s
                """,
                (str(session_ids[0]),),
            )
            audit_rows = await audits.fetchall()
            assert audit_rows == [({"reason": "administrator_revocation"},)]
            forbidden_keys = {
                "name",
                "email",
                "phone",
                "rejection_reason",
                "ip",
                "user_agent",
                "cookie",
                "access_token",
                "refresh_token",
                "refresh_token_hash",
                "qr_token",
            }
            assert forbidden_keys.isdisjoint(audit_rows[0][0])

            with pytest.raises(ApiError) as missing:
                await service.revoke_as_admin(uuid4(), actor_id)
            assert missing.value.code == "KIOSK_SESSION_NOT_FOUND"
    finally:
        with psycopg.connect(database_url) as owner:
            owner.execute(
                "delete from app.audit_logs where actor_id = %s", (actor_id,)
            )
            owner.execute(
                "delete from app.kiosk_sessions where id = any(%s)",
                (all_session_ids,),
            )
            owner.execute("delete from app.user_profiles where user_id = %s", (actor_id,))
            owner.execute("delete from auth.users where id = %s", (actor_id,))


async def test_live_attendance_rate_limit_starts_expired_window_at_attempt_one() -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for rate-limit integration")

    key_hash = f"hmac-sha256:{uuid4().hex}"
    clock = FrozenClock(datetime(2026, 8, 22, 4, tzinfo=UTC))
    async with application_transaction(database_url=database_url) as connection:
        repository = AttendanceRepository(connection)
        for _ in range(30):
            assert await repository.consume_scan_rate_limit(key_hash, clock.now()) is True
        assert await repository.consume_scan_rate_limit(key_hash, clock.now()) is False

        clock.advance(minutes=1)
        assert await repository.consume_scan_rate_limit(key_hash, clock.now()) is True
        cursor = await connection.execute(
            """
            select attempt_count, blocked_until
            from app.rate_limit_buckets
            where bucket_key_hash = %s and action = 'attendance.scan'
            """,
            (key_hash,),
        )
        assert await cursor.fetchone() == (1, None)
        await connection.execute(
            "delete from app.rate_limit_buckets where bucket_key_hash = %s",
            (key_hash,),
        )


async def test_live_http_concurrent_application_decisions_commit_exactly_once(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for application race integration")

    admin = AuthenticatedUser(
        user_id=uuid4(),
        email=f"admin-{uuid4().hex}@example.com",
        provider="google",
        email_verified=True,
    )
    applicant = AuthenticatedUser(
        user_id=uuid4(),
        email=f"applicant-{uuid4().hex}@example.com",
        provider="google",
        email_verified=True,
    )
    user_ids = [admin.user_id, applicant.user_id]
    with psycopg.connect(database_url) as owner, owner.cursor() as cursor:
        cursor.executemany("insert into auth.users (id) values (%s)", [(item,) for item in user_ids])
        cursor.execute(
            """
            insert into app.user_profiles (user_id, email, name)
            values (%s, %s, '관리자')
            """,
            (admin.user_id, admin.email),
        )
        cursor.execute(
            """
            insert into app.staff_memberships (user_id, role)
            values (%s, 'admin')
            """,
            (admin.user_id,),
        )

    try:
        async with application_transaction(database_url=database_url) as connection:
            from backend.identity.repository import IdentityRepository
            from backend.identity.service import StaffService

            application = await StaffService(IdentityRepository(connection)).apply(
                applicant,
                name="신청 교사",
                phone="01099998888",
            )

        async def current_admin() -> AuthenticatedUser:
            return admin

        monkeypatch.setattr(identity_router_module.settings, "database_url", database_url)
        app.dependency_overrides[get_current_user] = current_admin
        try:
            approve, reject = await asyncio.gather(
                client.post(
                    f"/api/admin/teacher-applications/{application.id}/approve",
                    json={},
                ),
                client.post(
                    f"/api/admin/teacher-applications/{application.id}/reject",
                    json={"rejection_reason": "경합 검증용 비공개 사유"},
                ),
            )
        finally:
            app.dependency_overrides.clear()

        assert sorted([approve.status_code, reject.status_code]) == [200, 409]
        loser = approve if approve.status_code == 409 else reject
        assert loser.json()["error"]["code"] == "APPLICATION_ALREADY_REVIEWED"
        with psycopg.connect(database_url) as owner:
            application_row = owner.execute(
                "select status::text from app.teacher_applications where id = %s",
                (application.id,),
            ).fetchone()
            membership_count = owner.execute(
                "select count(*) from app.staff_memberships where user_id = %s",
                (applicant.user_id,),
            ).fetchone()
            audit_rows = owner.execute(
                """
                select details from app.audit_logs
                where target_type = 'teacher_application' and target_id = %s
                """,
                (str(application.id),),
            ).fetchall()

        assert application_row[0] in {"approved", "rejected"}
        assert membership_count == ((1,) if application_row[0] == "approved" else (0,))
        assert audit_rows == [({"status": application_row[0]},)]
        assert "경합 검증용 비공개 사유" not in str(audit_rows)
    finally:
        with psycopg.connect(database_url) as owner:
            owner.execute("delete from app.audit_logs where actor_id = %s", (admin.user_id,))
            owner.execute("delete from app.teacher_applications where user_id = %s", (applicant.user_id,))
            owner.execute("delete from app.staff_memberships where user_id = any(%s)", (user_ids,))
            owner.execute("delete from app.user_profiles where user_id = any(%s)", (user_ids,))
            owner.execute("delete from auth.users where id = any(%s)", (user_ids,))


async def test_live_http_last_admin_is_protected_under_concurrent_demotions(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for staff race integration")

    first = AuthenticatedUser(uuid4(), f"first-{uuid4().hex}@example.com", "google", True)
    second = AuthenticatedUser(uuid4(), f"second-{uuid4().hex}@example.com", "google", True)
    users = {str(first.user_id): first, str(second.user_id): second}
    user_ids = [first.user_id, second.user_id]
    with psycopg.connect(database_url) as owner, owner.cursor() as cursor:
        cursor.executemany("insert into auth.users (id) values (%s)", [(item,) for item in user_ids])
        cursor.executemany(
            "insert into app.user_profiles (user_id, email, name) values (%s, %s, %s)",
            [(first.user_id, first.email, "첫 관리자"), (second.user_id, second.email, "둘째 관리자")],
        )
        cursor.execute("insert into app.staff_memberships (user_id, role) values (%s, 'admin')", (first.user_id,))

    async def current_actor(request: Request) -> AuthenticatedUser:
        return users[request.headers["X-Test-Actor"]]

    monkeypatch.setattr(identity_router_module.settings, "database_url", database_url)
    app.dependency_overrides[get_current_user] = current_actor
    try:
        protected = await client.patch(
            f"/api/admin/staff/{first.user_id}/role",
            headers={"X-Test-Actor": str(first.user_id)},
            json={"role": "teacher"},
        )
        assert protected.status_code == 409
        assert protected.json()["error"]["code"] == "LAST_ADMIN_PROTECTED"

        with psycopg.connect(database_url) as owner:
            owner.execute(
                "insert into app.staff_memberships (user_id, role) values (%s, 'admin')",
                (second.user_id,),
            )

        first_response, second_response = await asyncio.gather(
            client.patch(
                f"/api/admin/staff/{second.user_id}/role",
                headers={"X-Test-Actor": str(first.user_id)},
                json={"role": "teacher"},
            ),
            client.patch(
                f"/api/admin/staff/{first.user_id}/role",
                headers={"X-Test-Actor": str(second.user_id)},
                json={"role": "teacher"},
            ),
        )
        assert sorted([first_response.status_code, second_response.status_code]) == [200, 403]
        with psycopg.connect(database_url) as owner:
            roles = owner.execute(
                "select role::text from app.staff_memberships where user_id = any(%s)",
                (user_ids,),
            ).fetchall()
            audits = owner.execute(
                "select details from app.audit_logs where actor_id = any(%s) and action = 'staff.role_changed'",
                (user_ids,),
            ).fetchall()
        assert sum(role == ("admin",) for role in roles) == 1
        assert audits == [({"role": "teacher"},)]
    finally:
        app.dependency_overrides.clear()
        with psycopg.connect(database_url) as owner:
            owner.execute("delete from app.audit_logs where actor_id = any(%s)", (user_ids,))
            owner.execute("delete from app.staff_memberships where user_id = any(%s)", (user_ids,))
            owner.execute("delete from app.user_profiles where user_id = any(%s)", (user_ids,))
            owner.execute("delete from auth.users where id = any(%s)", (user_ids,))
