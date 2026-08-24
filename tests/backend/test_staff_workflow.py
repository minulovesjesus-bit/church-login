import asyncio
import os
from uuid import UUID, uuid4

import httpx
import psycopg
import pytest

from backend.core.auth import get_current_user, require_google_user
from backend.core.config import settings
from backend.core.db import application_transaction
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.repository import (
    IdentityRepository,
    StaffMemberRecord,
    TeacherApplicationRecord,
)
from backend.identity.router import (
    get_staff_service,
    require_admin,
    require_teacher,
)
from backend.identity.router import (
    router as identity_router,
)
from backend.identity.schemas import (
    StaffRole,
    TeacherApplicationStatus,
    TeacherApplicationView,
)
from backend.identity.service import LastAdminProtected, StaffService
from backend.main import app


class InMemoryStaffRepository:
    def __init__(self) -> None:
        self.applications: list[TeacherApplicationRecord] = []
        self.staff: dict[UUID, StaffMemberRecord] = {}
        self.audit_actions: list[tuple[str, UUID, UUID]] = []
        self.bootstrap_completed = False
        self.locked_role_changes = 0

    async def create_or_get_teacher_application(
        self,
        user: AuthenticatedUser,
        *,
        name: str,
        phone: str,
    ) -> TeacherApplicationRecord:
        pending = next(
            (
                application
                for application in reversed(self.applications)
                if application.user_id == user.user_id
                and application.status == TeacherApplicationStatus.PENDING
            ),
            None,
        )
        if pending is not None:
            return pending
        application = TeacherApplicationRecord(
            id=uuid4(),
            user_id=user.user_id,
            email=user.email,
            name=name,
            phone=phone,
            status=TeacherApplicationStatus.PENDING,
            rejection_reason=None,
        )
        self.applications.append(application)
        return application

    async def teacher_application_state(
        self, user_id: UUID
    ) -> TeacherApplicationRecord | None:
        if user_id in self.staff:
            member = self.staff[user_id]
            return TeacherApplicationRecord(
                id=uuid4(),
                user_id=user_id,
                email=member.email,
                name=member.name,
                phone=member.phone,
                status=TeacherApplicationStatus.APPROVED,
                rejection_reason=None,
            )
        return next(
            (
                application
                for application in reversed(self.applications)
                if application.user_id == user_id
            ),
            None,
        )

    async def staff_role(self, user_id: UUID) -> StaffRole | None:
        member = self.staff.get(user_id)
        return member.role if member else None

    async def bootstrap_initial_admin(self, user: AuthenticatedUser) -> bool:
        if self.bootstrap_completed:
            return False
        self.bootstrap_completed = True
        current = self.staff.get(user.user_id)
        self.staff[user.user_id] = StaffMemberRecord(
            user_id=user.user_id,
            email=user.email,
            name=current.name if current else user.email.split("@", maxsplit=1)[0],
            phone=current.phone if current else None,
            role=StaffRole.ADMIN,
        )
        self.audit_actions.append(("staff.bootstrap_admin", user.user_id, user.user_id))
        return True

    async def decide_teacher_application(
        self,
        actor_id: UUID,
        application_id: UUID,
        *,
        decision: TeacherApplicationStatus,
        rejection_reason: str | None,
    ) -> TeacherApplicationRecord:
        application = next(item for item in self.applications if item.id == application_id)
        if application.status != TeacherApplicationStatus.PENDING:
            raise ApiError("APPLICATION_ALREADY_REVIEWED", "이미 처리된 신청입니다.", 409)
        decided = TeacherApplicationRecord(
            id=application.id,
            user_id=application.user_id,
            email=application.email,
            name=application.name,
            phone=application.phone,
            status=decision,
            rejection_reason=rejection_reason,
        )
        self.applications[self.applications.index(application)] = decided
        if decision == TeacherApplicationStatus.APPROVED:
            self.staff[application.user_id] = StaffMemberRecord(
                user_id=application.user_id,
                email=application.email,
                name=application.name,
                phone=application.phone,
                role=StaffRole.TEACHER,
            )
        self.audit_actions.append(
            (f"teacher_application.{decision.value}", actor_id, application.user_id)
        )
        return decided

    async def list_pending_teacher_applications(self) -> list[TeacherApplicationRecord]:
        return [
            application
            for application in self.applications
            if application.status == TeacherApplicationStatus.PENDING
        ]

    async def list_staff(self) -> list[StaffMemberRecord]:
        return list(self.staff.values())

    async def lock_staff_memberships(self) -> list[tuple[UUID, StaffRole]]:
        self.locked_role_changes += 1
        return [(member.user_id, member.role) for member in self.staff.values()]

    async def staff_member(self, user_id: UUID) -> StaffMemberRecord | None:
        return self.staff.get(user_id)

    async def update_staff_role(
        self, actor_id: UUID, target_user_id: UUID, role: StaffRole
    ) -> StaffMemberRecord:
        current = self.staff[target_user_id]
        changed = StaffMemberRecord(
            user_id=current.user_id,
            email=current.email,
            name=current.name,
            phone=current.phone,
            role=role,
        )
        self.staff[target_user_id] = changed
        self.audit_actions.append(("staff.role_changed", actor_id, target_user_id))
        return changed


@pytest.fixture
def google_user() -> AuthenticatedUser:
    return AuthenticatedUser(
        user_id=uuid4(),
        email="teacher@example.com",
        provider="google",
        email_verified=True,
    )


@pytest.fixture
def staff_repository() -> InMemoryStaffRepository:
    return InMemoryStaffRepository()


@pytest.fixture
def staff_service(staff_repository: InMemoryStaffRepository) -> StaffService:
    return StaffService(staff_repository, initial_admin_email="initial@example.com")


async def test_google_user_requires_admin_approval(
    staff_service: StaffService, google_user: AuthenticatedUser
) -> None:
    application = await staff_service.apply(
        google_user, name="김교사", phone="01011112222"
    )

    assert application.status == TeacherApplicationStatus.PENDING
    assert await staff_service.has_teacher_access(google_user.user_id) is False


async def test_password_identity_cannot_apply_even_when_body_cannot_spoof_provider(
    staff_service: StaffService,
) -> None:
    password_user = AuthenticatedUser(
        user_id=uuid4(),
        email="teacher@example.com",
        provider="password",
        email_verified=True,
    )

    with pytest.raises(ApiError) as error:
        await staff_service.apply(
            password_user, name="김교사", phone="01011112222"
        )

    assert error.value.code == "GOOGLE_AUTH_REQUIRED"


@pytest.mark.parametrize("provider", ["google", "password"])
async def test_teacher_membership_authorizes_any_provider(
    staff_repository: InMemoryStaffRepository,
    provider: str,
) -> None:
    actor = AuthenticatedUser(
        user_id=uuid4(),
        email="teacher@example.com",
        provider=provider,
        email_verified=True,
    )
    staff_repository.staff[actor.user_id] = StaffMemberRecord(
        user_id=actor.user_id,
        email=actor.email,
        name="김교사",
        phone=None,
        role=StaffRole.TEACHER,
    )

    assert await require_teacher(actor, staff_repository) == actor


async def test_rejected_google_user_can_reapply(
    staff_service: StaffService,
    staff_repository: InMemoryStaffRepository,
    google_user: AuthenticatedUser,
) -> None:
    first = await staff_service.apply(google_user, name="김교사", phone="01011112222")
    admin_id = uuid4()
    staff_repository.staff[admin_id] = StaffMemberRecord(
        user_id=admin_id,
        email="admin@example.com",
        name="관리자",
        phone=None,
        role=StaffRole.ADMIN,
    )
    rejected = await staff_service.decide_application(
        admin_id,
        first.id,
        decision="rejected",
        rejection_reason="연락처를 확인해 주세요.",
    )

    second = await staff_service.apply(google_user, name="김교사", phone="01099998888")

    assert rejected.status == TeacherApplicationStatus.REJECTED
    assert second.id != first.id
    assert second.status == TeacherApplicationStatus.PENDING
    assert staff_repository.audit_actions[-1] == (
        "teacher_application.rejected",
        admin_id,
        google_user.user_id,
    )


async def test_approval_creates_teacher_access_and_audit(
    staff_service: StaffService,
    staff_repository: InMemoryStaffRepository,
    google_user: AuthenticatedUser,
) -> None:
    application = await staff_service.apply(
        google_user, name="김교사", phone="01011112222"
    )
    admin_id = uuid4()
    staff_repository.staff[admin_id] = StaffMemberRecord(
        user_id=admin_id,
        email="admin@example.com",
        name="관리자",
        phone=None,
        role=StaffRole.ADMIN,
    )

    approved = await staff_service.decide_application(
        admin_id, application.id, decision="approved"
    )

    assert approved.status == TeacherApplicationStatus.APPROVED
    assert await staff_service.has_teacher_access(google_user.user_id) is True
    assert staff_repository.audit_actions[-1] == (
        "teacher_application.approved",
        admin_id,
        google_user.user_id,
    )


async def test_initial_admin_bootstrap_requires_exact_verified_google_email(
    staff_repository: InMemoryStaffRepository,
) -> None:
    service = StaffService(staff_repository, initial_admin_email="initial@example.com")
    exact_google = AuthenticatedUser(
        user_id=uuid4(),
        email="initial@example.com",
        provider="google",
        email_verified=True,
    )
    wrong_case = AuthenticatedUser(
        user_id=uuid4(),
        email="Initial@example.com",
        provider="google",
        email_verified=True,
    )
    unverified = AuthenticatedUser(
        user_id=uuid4(),
        email="initial@example.com",
        provider="google",
        email_verified=False,
    )
    password_user = AuthenticatedUser(
        user_id=uuid4(),
        email="initial@example.com",
        provider="password",
        email_verified=True,
    )

    assert await service.bootstrap_initial_admin(wrong_case) is False
    assert await service.bootstrap_initial_admin(unverified) is False
    assert await service.bootstrap_initial_admin(password_user) is False
    assert await service.bootstrap_initial_admin(exact_google) is True
    assert await service.bootstrap_initial_admin(exact_google) is False
    assert await staff_repository.staff_role(exact_google.user_id) == StaffRole.ADMIN
    assert staff_repository.audit_actions == [
        ("staff.bootstrap_admin", exact_google.user_id, exact_google.user_id)
    ]


async def test_initial_admin_bootstrap_does_not_undo_later_admin_demotion(
    staff_repository: InMemoryStaffRepository,
) -> None:
    initial_admin = AuthenticatedUser(
        user_id=uuid4(),
        email="initial@example.com",
        provider="google",
        email_verified=True,
    )
    other_admin_id = uuid4()
    service = StaffService(
        staff_repository, initial_admin_email=initial_admin.email
    )

    assert await service.bootstrap_initial_admin(initial_admin) is True
    staff_repository.staff[other_admin_id] = StaffMemberRecord(
        user_id=other_admin_id,
        email="other-admin@example.com",
        name="다른 관리자",
        phone=None,
        role=StaffRole.ADMIN,
    )
    await service.set_role(other_admin_id, initial_admin.user_id, "teacher")

    assert await service.bootstrap_initial_admin(initial_admin) is False
    assert await staff_repository.staff_role(initial_admin.user_id) == StaffRole.TEACHER
    assert [
        action
        for action, _, _ in staff_repository.audit_actions
        if action == "staff.bootstrap_admin"
    ] == ["staff.bootstrap_admin"]


async def test_initial_admin_bootstrap_marker_is_global_when_configured_email_changes(
    staff_repository: InMemoryStaffRepository,
) -> None:
    first_user = AuthenticatedUser(
        user_id=uuid4(),
        email="first-initial@example.com",
        provider="google",
        email_verified=True,
    )
    later_user = AuthenticatedUser(
        user_id=uuid4(),
        email="later-initial@example.com",
        provider="google",
        email_verified=True,
    )

    assert await StaffService(
        staff_repository, initial_admin_email=first_user.email
    ).bootstrap_initial_admin(first_user) is True
    assert await StaffService(
        staff_repository, initial_admin_email=later_user.email
    ).bootstrap_initial_admin(later_user) is False

    assert await staff_repository.staff_role(first_user.user_id) == StaffRole.ADMIN
    assert await staff_repository.staff_role(later_user.user_id) is None
    assert [
        action
        for action, _, _ in staff_repository.audit_actions
        if action == "staff.bootstrap_admin"
    ] == ["staff.bootstrap_admin"]


async def test_admin_can_promote_teacher_without_removing_other_admins(
    staff_service: StaffService,
    staff_repository: InMemoryStaffRepository,
    google_user: AuthenticatedUser,
) -> None:
    first_admin = StaffMemberRecord(
        user_id=uuid4(),
        email="admin@example.com",
        name="관리자",
        phone=None,
        role=StaffRole.ADMIN,
    )
    teacher = StaffMemberRecord(
        user_id=google_user.user_id,
        email=google_user.email,
        name="김교사",
        phone="01011112222",
        role=StaffRole.TEACHER,
    )
    staff_repository.staff = {first_admin.user_id: first_admin, teacher.user_id: teacher}

    promoted = await staff_service.set_role(
        first_admin.user_id, teacher.user_id, "admin"
    )

    assert promoted.role == StaffRole.ADMIN
    assert sum(member.role == StaffRole.ADMIN for member in staff_repository.staff.values()) == 2
    assert staff_repository.locked_role_changes == 1
    assert staff_repository.audit_actions[-1] == (
        "staff.role_changed",
        first_admin.user_id,
        teacher.user_id,
    )


async def test_last_admin_cannot_be_demoted(
    staff_service: StaffService, staff_repository: InMemoryStaffRepository
) -> None:
    sole_admin = StaffMemberRecord(
        user_id=uuid4(),
        email="admin@example.com",
        name="관리자",
        phone=None,
        role=StaffRole.ADMIN,
    )
    staff_repository.staff[sole_admin.user_id] = sole_admin

    with pytest.raises(LastAdminProtected):
        await staff_service.set_role(
            sole_admin.user_id, sole_admin.user_id, "teacher"
        )

    assert staff_repository.locked_role_changes == 1
    assert staff_repository.audit_actions == []


async def test_one_of_multiple_admins_can_be_demoted(
    staff_service: StaffService, staff_repository: InMemoryStaffRepository
) -> None:
    actor_id = uuid4()
    target_id = uuid4()
    staff_repository.staff = {
        actor_id: StaffMemberRecord(
            user_id=actor_id,
            email="admin-one@example.com",
            name="관리자1",
            phone=None,
            role=StaffRole.ADMIN,
        ),
        target_id: StaffMemberRecord(
            user_id=target_id,
            email="admin-two@example.com",
            name="관리자2",
            phone=None,
            role=StaffRole.ADMIN,
        ),
    }

    demoted = await staff_service.set_role(actor_id, target_id, "teacher")

    assert demoted.role == StaffRole.TEACHER
    assert staff_repository.staff[actor_id].role == StaffRole.ADMIN


async def test_role_change_rechecks_actor_from_locked_memberships(
    staff_service: StaffService, staff_repository: InMemoryStaffRepository
) -> None:
    actor_id = uuid4()
    target_id = uuid4()
    staff_repository.staff = {
        actor_id: StaffMemberRecord(
            user_id=actor_id,
            email="former-admin@example.com",
            name="전 관리자",
            phone=None,
            role=StaffRole.TEACHER,
        ),
        target_id: StaffMemberRecord(
            user_id=target_id,
            email="teacher@example.com",
            name="교사",
            phone=None,
            role=StaffRole.TEACHER,
        ),
    }

    with pytest.raises(ApiError) as error:
        await staff_service.set_role(actor_id, target_id, "admin")

    assert error.value.code == "FORBIDDEN"
    assert staff_repository.staff[target_id].role == StaffRole.TEACHER


async def test_application_decision_rechecks_actor_from_locked_memberships(
    staff_service: StaffService,
    staff_repository: InMemoryStaffRepository,
    google_user: AuthenticatedUser,
) -> None:
    application = await staff_service.apply(
        google_user, name="김교사", phone="01011112222"
    )
    former_admin_id = uuid4()
    staff_repository.staff[former_admin_id] = StaffMemberRecord(
        user_id=former_admin_id,
        email="former-admin@example.com",
        name="전 관리자",
        phone=None,
        role=StaffRole.TEACHER,
    )

    with pytest.raises(ApiError) as error:
        await staff_service.decide_application(
            former_admin_id, application.id, decision="approved"
        )

    assert error.value.code == "FORBIDDEN"
    assert application.status == TeacherApplicationStatus.PENDING


class ApiStaffService:
    def __init__(self) -> None:
        self.applied = False

    async def apply(
        self, user: AuthenticatedUser, *, name: str, phone: str
    ) -> TeacherApplicationView:
        self.applied = True
        return TeacherApplicationView(
            id=uuid4(),
            user_id=user.user_id,
            email=user.email,
            name=name,
            phone=phone,
            status=TeacherApplicationStatus.PENDING,
            rejection_reason=None,
        )


async def test_application_request_cannot_supply_provider_or_current_role(
    client: httpx.AsyncClient, google_user: AuthenticatedUser
) -> None:
    service = ApiStaffService()

    async def current_google_user() -> AuthenticatedUser:
        return google_user

    app.dependency_overrides[require_google_user] = current_google_user
    app.dependency_overrides[get_staff_service] = lambda: service
    try:
        response = await client.post(
            "/api/teacher-applications",
            json={
                "name": "김교사",
                "phone": "01011112222",
                "provider": "google",
                "current_role": "admin",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert service.applied is False


async def test_teacher_application_commit_failure_happens_before_response(
    client: httpx.AsyncClient, google_user: AuthenticatedUser
) -> None:
    service = ApiStaffService()

    async def current_google_user() -> AuthenticatedUser:
        return google_user

    async def failing_staff_transaction():
        yield service
        raise ApiError("DATABASE_UNAVAILABLE", "잠시 후 다시 시도해 주세요.", 503)

    app.dependency_overrides[require_google_user] = current_google_user
    app.dependency_overrides[get_staff_service] = failing_staff_transaction
    try:
        response = await client.post(
            "/api/teacher-applications",
            json={"name": "김교사", "phone": "01011112222"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"


async def test_role_request_cannot_supply_actor_or_current_role(
    client: httpx.AsyncClient, google_user: AuthenticatedUser
) -> None:
    service = ApiStaffService()

    async def current_admin() -> AuthenticatedUser:
        return google_user

    app.dependency_overrides[require_admin] = current_admin
    app.dependency_overrides[get_staff_service] = lambda: service
    try:
        response = await client.patch(
            f"/api/admin/staff/{uuid4()}/role",
            json={
                "role": "admin",
                "actor_id": str(uuid4()),
                "current_role": "teacher",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422


def test_temporary_teacher_application_gate_was_replaced_once() -> None:
    matches = [
        route
        for route in identity_router.routes
        if getattr(route, "path", None) == "/api/teacher-applications"
        and "POST" in getattr(route, "methods", set())
    ]

    assert len(matches) == 1


class LockCursor:
    async def fetchall(self) -> list[tuple[UUID, str]]:
        return [(uuid4(), "admin")]


class RecordingLockConnection:
    def __init__(self) -> None:
        self.statements: list[str] = []

    async def execute(self, statement: str, _parameters: object = None) -> LockCursor:
        self.statements.append(" ".join(statement.split()).lower())
        return LockCursor()


async def test_staff_role_guard_serializes_then_locks_memberships() -> None:
    connection = RecordingLockConnection()

    memberships = await IdentityRepository(connection).lock_staff_memberships()

    assert memberships[0][1] == StaffRole.ADMIN
    assert "pg_advisory_xact_lock" in connection.statements[0]
    assert "from app.staff_memberships" in connection.statements[1]
    assert connection.statements[1].endswith("for update")


async def test_live_staff_workflow_is_audited_and_never_loses_last_admin() -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for the live staff workflow")

    test_run = uuid4().hex
    first_admin = AuthenticatedUser(
        user_id=uuid4(),
        email=f"initial-{test_run}@example.com",
        provider="google",
        email_verified=True,
    )
    second_admin = AuthenticatedUser(
        user_id=uuid4(),
        email=f"second-{test_run}@example.com",
        provider="google",
        email_verified=True,
    )
    applicant = AuthenticatedUser(
        user_id=uuid4(),
        email=f"teacher-{test_run}@example.com",
        provider="google",
        email_verified=True,
    )
    user_ids = (first_admin.user_id, second_admin.user_id, applicant.user_id)

    with psycopg.connect(database_url) as owner, owner.cursor() as cursor:
        cursor.executemany(
            "insert into auth.users (id) values (%s)",
            [(item,) for item in user_ids],
        )
    try:
        async with application_transaction(database_url=database_url) as connection:
            service = StaffService(
                IdentityRepository(connection), initial_admin_email=first_admin.email
            )
            assert await service.bootstrap_initial_admin(first_admin) is True
            assert await service.bootstrap_initial_admin(first_admin) is False
            changed_configuration = StaffService(
                IdentityRepository(connection),
                initial_admin_email=second_admin.email,
            )
            assert await changed_configuration.bootstrap_initial_admin(second_admin) is False
            assert await changed_configuration.has_teacher_access(second_admin.user_id) is False

            application = await service.apply(
                applicant, name="김교사", phone="01011112222"
            )
            await service.decide_application(
                first_admin.user_id, application.id, decision="approved"
            )
            await service.set_role(
                first_admin.user_id, applicant.user_id, StaffRole.ADMIN.value
            )

        async def demote(actor: AuthenticatedUser, target: AuthenticatedUser) -> str:
            try:
                async with application_transaction(database_url=database_url) as connection:
                    service = StaffService(IdentityRepository(connection))
                    await service.set_role(
                        actor.user_id, target.user_id, StaffRole.TEACHER.value
                    )
                return "changed"
            except LastAdminProtected:
                return "protected"
            except ApiError as error:
                assert error.code == "FORBIDDEN"
                return "forbidden"

        outcomes = await asyncio.gather(
            demote(first_admin, applicant), demote(applicant, first_admin)
        )

        with psycopg.connect(database_url) as owner:
            roles = owner.execute(
                "select role::text from app.staff_memberships where user_id = any(%s)",
                (list(user_ids),),
            ).fetchall()
            audits = owner.execute(
                "select action from app.audit_logs where actor_id = any(%s)",
                (list(user_ids),),
            ).fetchall()

        assert "changed" in outcomes
        assert ({"protected", "forbidden"} & set(outcomes))
        assert sum(row[0] == "admin" for row in roles) == 1
        assert [row[0] for row in audits].count("staff.bootstrap_admin") == 1
        assert [row[0] for row in audits].count("teacher_application.approved") == 1
        assert [row[0] for row in audits].count("staff.role_changed") == 2
    finally:
        with psycopg.connect(database_url) as owner:
            owner.execute(
                "delete from app.audit_logs where actor_id = any(%s)",
                (list(user_ids),),
            )
            owner.execute(
                "delete from app.teacher_applications where user_id = any(%s)",
                (list(user_ids),),
            )
            owner.execute(
                "delete from app.staff_memberships where user_id = any(%s)",
                (list(user_ids),),
            )
            owner.execute(
                "delete from app.user_profiles where user_id = any(%s)",
                (list(user_ids),),
            )
            owner.execute("delete from auth.users where id = any(%s)", (list(user_ids),))


async def test_live_demoted_initial_admin_is_not_bootstrapped_again_on_admin_api(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for the live bootstrap regression")

    test_run = uuid4().hex
    initial_admin = AuthenticatedUser(
        user_id=uuid4(),
        email=f"initial-{test_run}@example.com",
        provider="google",
        email_verified=True,
    )
    other_admin = AuthenticatedUser(
        user_id=uuid4(),
        email=f"other-{test_run}@example.com",
        provider="google",
        email_verified=True,
    )
    user_ids = (initial_admin.user_id, other_admin.user_id)

    with psycopg.connect(database_url) as owner, owner.cursor() as cursor:
        cursor.executemany(
            "insert into auth.users (id) values (%s)",
            [(item,) for item in user_ids],
        )
    try:
        async def bootstrap_once() -> bool:
            async with application_transaction(database_url=database_url) as connection:
                return await StaffService(
                    IdentityRepository(connection),
                    initial_admin_email=initial_admin.email,
                ).bootstrap_initial_admin(initial_admin)

        bootstrap_results = await asyncio.gather(bootstrap_once(), bootstrap_once())
        assert sorted(bootstrap_results) == [False, True]

        async with application_transaction(database_url=database_url) as connection:
            service = StaffService(IdentityRepository(connection))
            application = await service.apply(
                other_admin, name="다른 관리자", phone="01022223333"
            )
            await service.decide_application(
                initial_admin.user_id,
                application.id,
                decision="approved",
            )
            await service.set_role(
                initial_admin.user_id,
                other_admin.user_id,
                StaffRole.ADMIN.value,
            )
            await service.set_role(
                other_admin.user_id,
                initial_admin.user_id,
                StaffRole.TEACHER.value,
            )

        async def current_google_user() -> AuthenticatedUser:
            return initial_admin

        monkeypatch.setattr(settings, "database_url", database_url)
        monkeypatch.setattr(settings, "initial_admin_email", initial_admin.email)
        app.dependency_overrides[get_current_user] = current_google_user
        try:
            response = await client.get("/api/admin/staff")
        finally:
            app.dependency_overrides.clear()

        with psycopg.connect(database_url) as owner:
            role = owner.execute(
                "select role::text from app.staff_memberships where user_id = %s",
                (initial_admin.user_id,),
            ).fetchone()
            bootstrap_audits = owner.execute(
                """
                select count(*)
                from app.audit_logs
                where action = 'staff.bootstrap_admin'
                  and target_id = %s
                """,
                (str(initial_admin.user_id),),
            ).fetchone()

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
        assert role == ("teacher",)
        assert bootstrap_audits == (1,)
    finally:
        with psycopg.connect(database_url) as owner:
            owner.execute(
                "delete from app.audit_logs where actor_id = any(%s)",
                (list(user_ids),),
            )
            owner.execute(
                "delete from app.teacher_applications where user_id = any(%s)",
                (list(user_ids),),
            )
            owner.execute(
                "delete from app.staff_memberships where user_id = any(%s)",
                (list(user_ids),),
            )
            owner.execute(
                "delete from app.user_profiles where user_id = any(%s)",
                (list(user_ids),),
            )
            owner.execute(
                "delete from auth.users where id = any(%s)",
                (list(user_ids),),
            )


async def test_me_bootstraps_matching_initial_admin_and_returns_committed_capability(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for the live bootstrap journey")

    user = AuthenticatedUser(
        user_id=uuid4(),
        email=f"normal-bootstrap-{uuid4().hex}@example.com",
        provider="google",
        email_verified=True,
    )
    with psycopg.connect(database_url) as owner:
        owner.execute("insert into auth.users (id) values (%s)", (user.user_id,))

    async def current_google_user() -> AuthenticatedUser:
        return user

    monkeypatch.setattr(settings, "database_url", database_url)
    monkeypatch.setattr(settings, "initial_admin_email", user.email)
    app.dependency_overrides[get_current_user] = current_google_user
    try:
        response = await client.get("/api/me")

        with psycopg.connect(database_url) as owner:
            role = owner.execute(
                "select role::text from app.staff_memberships where user_id = %s",
                (user.user_id,),
            ).fetchone()
            bootstrap_audits = owner.execute(
                """
                select count(*)
                from app.audit_logs
                where action = 'staff.bootstrap_admin'
                """
            ).fetchone()

        assert response.status_code == 200
        assert response.json()["capabilities"] == {
            "student": False,
            "teacher": True,
            "admin": True,
        }
        assert role == ("admin",)
        assert bootstrap_audits == (1,)
    finally:
        app.dependency_overrides.clear()
        with psycopg.connect(database_url) as owner:
            owner.execute(
                "delete from app.audit_logs where actor_id = %s",
                (user.user_id,),
            )
            owner.execute(
                "delete from app.staff_memberships where user_id = %s",
                (user.user_id,),
            )
            owner.execute(
                "delete from app.user_profiles where user_id = %s",
                (user.user_id,),
            )
            owner.execute("delete from auth.users where id = %s", (user.user_id,))
