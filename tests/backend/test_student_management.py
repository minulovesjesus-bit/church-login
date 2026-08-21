import base64
import json
import os
from datetime import UTC, date, datetime
from urllib.parse import urlsplit
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import httpx
import psycopg
import pytest
from pydantic import ValidationError

from backend.attendance.repository import AttendanceRepository
from backend.attendance.schemas import TeacherStatisticsFilters
from backend.attendance.service import AttendanceService
from backend.core.auth import get_current_user
from backend.core.clock import FrozenClock
from backend.core.config import settings
from backend.core.db import application_transaction
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.repository import IdentityRepository
from backend.identity.router import get_identity_repository, require_teacher
from backend.identity.service import IdentityService
from backend.main import app
from backend.students.repository import StudentRepository
from backend.students.router import get_student_service
from backend.students.schemas import (
    StatisticsFilter,
    StudentListFilters,
    TeacherStudentUpdate,
    TeacherStudentView,
)
from backend.students.service import StudentService


class UnusedQrService:
    async def verify_qr_challenge(self, _token: str):
        raise AssertionError("student management must not verify QR tokens")


def _user(*, provider: str = "google", email: str = "teacher@example.test") -> AuthenticatedUser:
    return AuthenticatedUser(
        user_id=uuid4(),
        email=email,
        provider=provider,
        email_verified=True,
    )


def _student(index: int, *, included: bool = True) -> TeacherStudentView:
    return TeacherStudentView(
        user_id=UUID(f"00000000-0000-4000-8000-{index:012d}"),
        email=f"student{index}@example.test",
        name=f"학생 {index:03d}",
        birth_date=date(2012, 4, 3),
        phone="01012345678",
        guardian_phone="01098765432",
        include_in_statistics=included,
    )


def _encoded_cursor_payload(payload: object) -> str:
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).decode("ascii")
    return encoded.rstrip("=")


class FakeStudentRepository:
    def __init__(self, students: list[TeacherStudentView], *, role: str | None = "teacher") -> None:
        self.students = students
        self.role = role
        self.list_calls: list[tuple[StudentListFilters, object]] = []
        self.update_calls: list[tuple[UUID, TeacherStudentUpdate, UUID]] = []

    async def active_staff_role(self, _user_id: UUID) -> str | None:
        return self.role

    async def list_students(self, filters: StudentListFilters, cursor_key: object):
        self.list_calls.append((filters, cursor_key))
        start = 0
        if cursor_key is not None:
            cursor_id = cursor_key.user_id
            start = next(
                index + 1
                for index, student in enumerate(self.students)
                if student.user_id == cursor_id
            )
        return self.students[start : start + filters.page_size + 1]

    async def update_student(
        self,
        student_id: UUID,
        command: TeacherStudentUpdate,
        actor_id: UUID,
    ) -> TeacherStudentView | None:
        self.update_calls.append((student_id, command, actor_id))
        current = next((item for item in self.students if item.user_id == student_id), None)
        if current is None:
            return None
        return TeacherStudentView(
            user_id=current.user_id,
            email=current.email,
            **command.model_dump(),
        )


class FakeIdentityRepository:
    def __init__(self, role: str | None) -> None:
        self.role = role

    async def bootstrap_initial_admin(self, _user: AuthenticatedUser) -> bool:
        return False

    async def staff_role(self, _user_id: UUID):
        return self.role


class FakeStudentService:
    def __init__(self) -> None:
        self.student = _student(1)
        self.list_calls: list[tuple[AuthenticatedUser, StudentListFilters]] = []
        self.update_calls: list[tuple[AuthenticatedUser, UUID, TeacherStudentUpdate]] = []

    async def list_students(self, actor: AuthenticatedUser, filters: StudentListFilters):
        self.list_calls.append((actor, filters))
        return {
            "items": [self.student],
            "next_cursor": "opaque-next",
            "page_size": filters.page_size,
        }

    async def update_student(
        self,
        actor: AuthenticatedUser,
        student_id: UUID,
        command: TeacherStudentUpdate,
    ) -> TeacherStudentView:
        self.update_calls.append((actor, student_id, command))
        return TeacherStudentView(
            user_id=student_id,
            email=self.student.email,
            **command.model_dump(),
        )


def test_filters_and_complete_update_payload_normalize_and_reject_unsafe_values() -> None:
    filters = StudentListFilters(query="  김   학생  ", statistics="included", page_size=100)
    command = TeacherStudentUpdate(
        name="  김   학생  ",
        birth_date="2012-04-03",
        phone="010-1234-5678",
        guardian_phone="010 9876 5432",
        include_in_statistics=False,
    )

    assert filters.query == "김 학생"
    assert filters.statistics is StatisticsFilter.INCLUDED
    assert command.model_dump() == {
        "name": "김 학생",
        "birth_date": date(2012, 4, 3),
        "phone": "01012345678",
        "guardian_phone": "01098765432",
        "include_in_statistics": False,
    }

    invalid_filters = [
        {"query": "x" * 81},
        {"statistics": "disabled"},
        {"page_size": 0},
        {"page_size": 101},
        {"cursor": "x" * 2049},
    ]
    for values in invalid_filters:
        with pytest.raises(ValidationError):
            StudentListFilters(**values)

    for values in (
        {"name": "   "},
        {"birth_date": "2999-01-01"},
        {"birth_date": "2026-02-30"},
        {"phone": "123"},
        {"guardian_phone": "123"},
        {"email": "changed@example.test"},
    ):
        payload = {
            "name": "김학생",
            "birth_date": "2012-04-03",
            "phone": "01012345678",
            "guardian_phone": "01098765432",
            "include_in_statistics": True,
            **values,
        }
        with pytest.raises(ValidationError):
            TeacherStudentUpdate(**payload)


async def test_service_uses_opaque_filter_bound_keyset_without_duplicates() -> None:
    teacher = _user()
    repository = FakeStudentRepository([_student(index) for index in range(1, 102)])
    service = StudentService(repository)  # type: ignore[arg-type]

    first = await service.list_students(
        teacher,
        StudentListFilters(query="  학생  ", statistics="all", page_size=100),
    )
    assert len(first.items) == 100
    assert first.next_cursor is not None
    assert "학생" not in first.next_cursor

    second = await service.list_students(
        teacher,
        StudentListFilters(
            query="학생",
            statistics="all",
            page_size=100,
            cursor=first.next_cursor,
        ),
    )
    assert [item.user_id for item in second.items] == [_student(101).user_id]
    assert second.next_cursor is None
    assert not ({item.user_id for item in first.items} & {item.user_id for item in second.items})

    for cursor in ("not-base64", "e30", "x" * 2048):
        with pytest.raises(ApiError) as malformed:
            await service.list_students(
                teacher,
                StudentListFilters(statistics="all", cursor=cursor),
            )
        assert (malformed.value.code, malformed.value.status_code) == ("INVALID_CURSOR", 422)

    with pytest.raises(ApiError) as mismatched:
        await service.list_students(
            teacher,
            StudentListFilters(
                query="다른 검색",
                statistics="all",
                cursor=first.next_cursor,
            ),
        )
    assert mismatched.value.code == "INVALID_CURSOR"

    with pytest.raises(ApiError):
        await service.list_students(
            teacher,
            StudentListFilters(
                query="학생",
                statistics="excluded",
                cursor=first.next_cursor,
            ),
        )


@pytest.mark.parametrize(
    ("field", "invalid_value"),
    [
        pytest.param("v", True, id="version-bool"),
        pytest.param("v", 1.0, id="version-number-not-int"),
        pytest.param("v", None, id="version-null"),
        pytest.param("v", {}, id="version-object"),
        pytest.param("v", [], id="version-list"),
        pytest.param("v", 2, id="wrong-version"),
        pytest.param("q", 1, id="digest-number"),
        pytest.param("q", None, id="digest-null"),
        pytest.param("q", {}, id="digest-object"),
        pytest.param("q", [], id="digest-list"),
        pytest.param("q", True, id="digest-bool"),
        pytest.param("q", "", id="digest-empty"),
        pytest.param("q", "x" * 65, id="digest-oversized"),
        pytest.param("s", 1, id="statistics-number"),
        pytest.param("s", None, id="statistics-null"),
        pytest.param("s", {}, id="statistics-object"),
        pytest.param("s", [], id="statistics-list"),
        pytest.param("s", True, id="statistics-bool"),
        pytest.param("n", 1, id="name-number"),
        pytest.param("n", None, id="name-null"),
        pytest.param("n", {}, id="name-object"),
        pytest.param("n", [], id="name-list"),
        pytest.param("n", True, id="name-bool"),
        pytest.param("n", "", id="name-empty"),
        pytest.param("n", "x" * 81, id="name-oversized"),
        pytest.param("i", 1, id="id-number"),
        pytest.param("i", None, id="id-null"),
        pytest.param("i", {}, id="id-object"),
        pytest.param("i", [], id="id-list"),
        pytest.param("i", True, id="id-bool"),
        pytest.param("i", "", id="id-empty"),
        pytest.param("i", "x" * 37, id="id-oversized"),
    ],
)
async def test_service_rejects_type_invalid_cursor_fields(
    field: str,
    invalid_value: object,
) -> None:
    teacher = _user()
    repository = FakeStudentRepository([_student(1)])
    service = StudentService(repository)  # type: ignore[arg-type]
    payload: dict[str, object] = {
        "v": 1,
        "q": service._filter_digest(None),
        "s": "all",
        "n": "학생 001",
        "i": str(_student(1).user_id),
    }
    payload[field] = invalid_value

    with pytest.raises(ApiError) as malformed:
        await service.list_students(
            teacher,
            StudentListFilters(cursor=_encoded_cursor_payload(payload)),
        )

    assert (malformed.value.code, malformed.value.status_code) == ("INVALID_CURSOR", 422)


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param(None, id="root-null"),
        pytest.param(1, id="root-number"),
        pytest.param(True, id="root-bool"),
        pytest.param([], id="root-list"),
        pytest.param("cursor", id="root-string"),
        pytest.param(
            {"v": 1, "q": "x" * 64, "s": "all", "n": "학생 001"},
            id="missing-field",
        ),
        pytest.param(
            {
                "v": 1,
                "q": "x" * 64,
                "s": "all",
                "n": "학생 001",
                "i": str(_student(1).user_id),
                "unexpected": "value",
            },
            id="unexpected-field",
        ),
    ],
)
async def test_service_rejects_invalid_complete_cursor_shape(payload: object) -> None:
    teacher = _user()
    repository = FakeStudentRepository([_student(1)])
    service = StudentService(repository)  # type: ignore[arg-type]

    with pytest.raises(ApiError) as malformed:
        await service.list_students(
            teacher,
            StudentListFilters(cursor=_encoded_cursor_payload(payload)),
        )

    assert (malformed.value.code, malformed.value.status_code) == ("INVALID_CURSOR", 422)


async def test_repository_parameterizes_escaped_search_keyset_and_page_size_plus_one() -> None:
    class Cursor:
        async def fetchall(self):
            return []

    class RecordingConnection:
        def __init__(self) -> None:
            self.sql = ""
            self.parameters: dict[str, object] = {}

        async def execute(self, sql: str, parameters: dict[str, object]):
            self.sql = sql
            self.parameters = parameters
            return Cursor()

    connection = RecordingConnection()
    repository = StudentRepository(connection)
    filters = StudentListFilters(query=r"100%_참여\\반", statistics="excluded", page_size=100)
    await repository.list_students(filters, None)

    assert "offset" not in connection.sql.lower()
    assert "order by lower(profile.name), profile.user_id" in connection.sql.lower()
    assert "> (lower(%(cursor_name)s), %(cursor_user_id)s::uuid)" in connection.sql.lower()
    assert "ilike" in connection.sql.lower()
    assert connection.parameters["search"] == r"%100\%\_참여\\\\반%"
    assert connection.parameters["limit"] == 101
    assert connection.parameters["statistics"] == "excluded"


async def test_teacher_and_admin_routes_are_bounded_and_have_no_create_endpoint(
    client: httpx.AsyncClient,
) -> None:
    service = FakeStudentService()
    for role in ("teacher", "admin"):
        actor = _user(email=f"{role}@example.test")
        app.dependency_overrides[require_teacher] = lambda actor=actor: actor
        app.dependency_overrides[get_student_service] = lambda: service
        try:
            response = await client.get(
                "/api/teacher/students?query=%20%20%EA%B9%80%20%20%ED%95%99%EC%83%9D%20%20"
                "&statistics=excluded&page_size=50"
            )
            no_create = await client.post("/api/teacher/students", json={})
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        assert response.json()["page_size"] == 50
        assert response.json()["next_cursor"] == "opaque-next"
        assert service.list_calls[-1][1].query == "김 학생"
        assert service.list_calls[-1][1].statistics is StatisticsFilter.EXCLUDED
        assert no_create.status_code == 405


@pytest.mark.parametrize(
    ("provider", "role", "expected_code"),
    [("password", "teacher", "GOOGLE_AUTH_REQUIRED"), ("google", None, "FORBIDDEN")],
)
async def test_student_routes_reject_non_google_and_non_staff_identities(
    client: httpx.AsyncClient,
    provider: str,
    role: str | None,
    expected_code: str,
) -> None:
    actor = _user(provider=provider)
    app.dependency_overrides[get_current_user] = lambda: actor
    app.dependency_overrides[get_identity_repository] = lambda: FakeIdentityRepository(role)
    app.dependency_overrides[get_student_service] = FakeStudentService
    try:
        response = await client.get("/api/teacher/students")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json()["error"]["code"] == expected_code


async def test_patch_normalizes_complete_metadata_only_payload_and_missing_is_404(
    client: httpx.AsyncClient,
) -> None:
    actor = _user()
    service = FakeStudentService()
    student_id = service.student.user_id
    app.dependency_overrides[require_teacher] = lambda: actor
    app.dependency_overrides[get_student_service] = lambda: service
    payload = {
        "name": "  수정   학생  ",
        "birth_date": "2011-03-04",
        "phone": "010-2222-3333",
        "guardian_phone": "010 4444 5555",
        "include_in_statistics": False,
    }
    try:
        response = await client.patch(f"/api/teacher/students/{student_id}", json=payload)
        extra = await client.patch(
            f"/api/teacher/students/{student_id}",
            json={**payload, "email": "attacker@example.test"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["name"] == "수정 학생"
    assert response.json()["phone"] == "01022223333"
    assert response.json()["guardian_phone"] == "01044445555"
    assert service.update_calls[0][0] == actor
    assert extra.status_code == 422

    missing_service = StudentService(FakeStudentRepository([]))  # type: ignore[arg-type]
    with pytest.raises(ApiError) as missing:
        await missing_service.update_student(
            actor,
            uuid4(),
            TeacherStudentUpdate(**payload),
        )
    assert (missing.value.code, missing.value.status_code) == ("STUDENT_NOT_FOUND", 404)


def _loopback_database_url() -> str:
    database_url = os.environ.get("TEST_DATABASE_URL") or settings.database_url
    if not database_url or urlsplit(database_url).hostname not in {"127.0.0.1", "localhost", "::1"}:
        pytest.skip("A loopback TEST_DATABASE_URL is required")
    return database_url


async def _seed_live_students(database_url: str, *, count: int = 101):
    teacher_id = uuid4()
    student_ids = [UUID(f"10000000-0000-4000-8000-{index:012d}") for index in range(1, count + 1)]
    connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        async with connection.cursor() as cursor:
            await cursor.executemany(
                "insert into auth.users (id) values (%s)",
                [(teacher_id,), *[(student_id,) for student_id in student_ids]],
            )
            await cursor.executemany(
                "insert into app.user_profiles (user_id, email, name, phone) values (%s, %s, %s, %s)",
                [
                    (teacher_id, f"teacher-{teacher_id.hex}@example.test", "관리 교사", "01011112222"),
                    *[
                        (
                            student_id,
                            f"student-{index:03d}@example.test",
                            "100%_참여" if index == 1 else f"학생 {index:03d}",
                            "01012345678",
                        )
                        for index, student_id in enumerate(student_ids, start=1)
                    ],
                ],
            )
            await cursor.executemany(
                "insert into app.student_profiles (user_id, birth_date, guardian_phone) values (%s, '2012-04-03', '01098765432')",
                [(student_id,) for student_id in student_ids],
            )
        await connection.execute(
            "insert into app.staff_memberships (user_id, role) values (%s, 'teacher'), (%s, 'teacher')",
            (teacher_id, student_ids[0]),
        )
        await connection.execute(
            """
            insert into app.attendance_scans (
              student_id, attendance_date, direction, scanned_at,
              request_id, source, recorded_by
            ) values (%s, '2026-08-21', 'IN', '2026-08-21T01:00:00Z', %s, 'MANUAL', %s)
            """,
            (student_ids[0], uuid4(), teacher_id),
        )
        await connection.commit()
        return teacher_id, student_ids
    finally:
        await connection.close()


async def _cleanup_live_students(database_url: str, teacher_id: UUID, student_ids: list[UUID]) -> None:
    all_ids = [teacher_id, *student_ids]
    connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        await connection.execute(
            "delete from app.audit_logs where actor_id = any(%s) or target_id = any(%s)",
            (all_ids, [str(item) for item in all_ids]),
        )
        await connection.execute("delete from app.attendance_scans where student_id = any(%s)", (student_ids,))
        await connection.execute("delete from app.staff_memberships where user_id = any(%s)", (all_ids,))
        await connection.execute("delete from app.student_profiles where user_id = any(%s)", (student_ids,))
        await connection.execute("delete from app.user_profiles where user_id = any(%s)", (all_ids,))
        await connection.execute("delete from auth.users where id = any(%s)", (all_ids,))
        await connection.commit()
    finally:
        await connection.close()


async def test_live_keyset_row_101_and_reversible_statistics_exclusion_preserve_account() -> None:
    database_url = _loopback_database_url()
    teacher_id, student_ids = await _seed_live_students(database_url)
    teacher = AuthenticatedUser(
        user_id=teacher_id,
        email=f"teacher-{teacher_id.hex}@example.test",
        provider="google",
        email_verified=True,
    )
    student = AuthenticatedUser(
        user_id=student_ids[0],
        email="student-001@example.test",
        provider="password",
        email_verified=True,
    )
    try:
        async with application_transaction(database_url=database_url) as connection:
            repository = StudentRepository(connection)
            service = StudentService(repository)
            first = await service.list_students(teacher, StudentListFilters(page_size=100))
            second = await service.list_students(
                teacher,
                StudentListFilters(page_size=100, cursor=first.next_cursor),
            )
            literal_percent = await service.list_students(
                teacher,
                StudentListFilters(query="%", page_size=100),
            )

        assert len(first.items) == 100
        assert len(second.items) == 1
        assert first.next_cursor is not None
        assert second.next_cursor is None
        assert not ({item.user_id for item in first.items} & {item.user_id for item in second.items})
        assert [item.name for item in literal_percent.items] == ["100%_참여"]

        update = TeacherStudentUpdate(
            name="  변경   학생  ",
            birth_date=date(2011, 3, 4),
            phone="010-2222-3333",
            guardian_phone="010-4444-5555",
            include_in_statistics=False,
        )
        async with application_transaction(database_url=database_url) as connection:
            service = StudentService(StudentRepository(connection))
            excluded = await service.update_student(teacher, student.user_id, update)
            all_page = await service.list_students(
                teacher,
                StudentListFilters(query="변경 학생", statistics="all"),
            )
            excluded_page = await service.list_students(
                teacher,
                StudentListFilters(query="변경 학생", statistics="excluded"),
            )
            included_page = await service.list_students(
                teacher,
                StudentListFilters(query="변경 학생", statistics="included"),
            )

            identity = await IdentityService(IdentityRepository(connection)).current_identity(student)
            attendance_repository = AttendanceRepository(connection)
            personal = await AttendanceService(
                attendance_repository,
                UnusedQrService(),
                clock=FrozenClock(datetime(2026, 8, 21, 3, tzinfo=UTC)),
                rate_limit_secret="student-management-test-secret",
            ).student_summary(student)
            aggregate = await AttendanceService(
                attendance_repository,
                UnusedQrService(),
                clock=FrozenClock(datetime(2026, 8, 21, 3, tzinfo=UTC)),
                rate_limit_secret="student-management-test-secret",
            ).teacher_summary(
                teacher,
                TeacherStatisticsFilters(date_from=date(2026, 8, 21), date_to=date(2026, 8, 21)),
            )

        assert excluded.include_in_statistics is False
        assert [item.user_id for item in all_page.items] == [student.user_id]
        assert [item.user_id for item in excluded_page.items] == [student.user_id]
        assert included_page.items == []
        assert identity["onboarding_completed"] is True
        assert identity["capabilities"]["student"] is True
        assert personal.total_entries == 1
        assert aggregate.unique_students_today == 0

        connection = await psycopg.AsyncConnection.connect(database_url)
        try:
            cursor = await connection.execute(
                """
                select profile.email, profile.name, profile.phone,
                       student.birth_date, student.guardian_phone,
                       student.include_in_statistics,
                       exists(select 1 from auth.users where id = profile.user_id),
                       exists(select 1 from app.staff_memberships where user_id = profile.user_id),
                       (select count(*) from app.attendance_scans where student_id = profile.user_id)
                from app.user_profiles profile
                join app.student_profiles student using (user_id)
                where profile.user_id = %s
                """,
                (student.user_id,),
            )
            row = await cursor.fetchone()
            audit_cursor = await connection.execute(
                """
                select action, target_type, target_id, details
                from app.audit_logs
                where actor_id = %s and target_id = %s
                order by created_at, id
                """,
                (teacher.user_id, str(student.user_id)),
            )
            audits = await audit_cursor.fetchall()
        finally:
            await connection.close()

        assert row == (
            student.email,
            "변경 학생",
            "01022223333",
            date(2011, 3, 4),
            "01044445555",
            False,
            True,
            True,
            1,
        )
        assert len(audits) == 1
        assert audits[0][:3] == ("student.profile_updated", "student_profile", str(student.user_id))
        assert audits[0][3] == {
            "changed_fields": [
                "birth_date",
                "guardian_phone",
                "include_in_statistics",
                "name",
                "phone",
            ]
        }
        serialized_audit = json.dumps(audits[0][3], ensure_ascii=False)
        for pii in (student.email, "변경 학생", "01022223333", "01044445555"):
            assert pii not in serialized_audit

        async with application_transaction(database_url=database_url) as connection:
            service = StudentService(StudentRepository(connection))
            no_op = await service.update_student(teacher, student.user_id, update)
            reincluded = await service.update_student(
                teacher,
                student.user_id,
                update.model_copy(update={"include_in_statistics": True}),
            )
        assert no_op.include_in_statistics is False
        assert reincluded.include_in_statistics is True

        connection = await psycopg.AsyncConnection.connect(database_url)
        try:
            cursor = await connection.execute(
                "select details from app.audit_logs where actor_id = %s and target_id = %s order by created_at, id",
                (teacher.user_id, str(student.user_id)),
            )
            final_audits = await cursor.fetchall()
        finally:
            await connection.close()
        assert len(final_audits) == 2
        assert final_audits[1][0] == {"changed_fields": ["include_in_statistics"]}
    finally:
        await _cleanup_live_students(database_url, teacher_id, student_ids)


async def test_live_update_accepts_the_current_seoul_date_at_the_utc_date_boundary() -> None:
    database_url = _loopback_database_url()
    teacher_id, student_ids = await _seed_live_students(database_url, count=1)
    teacher = AuthenticatedUser(
        user_id=teacher_id,
        email=f"teacher-{teacher_id.hex}@example.test",
        provider="google",
        email_verified=True,
    )
    seoul_today = datetime.now(ZoneInfo("Asia/Seoul")).date()
    try:
        async with application_transaction(database_url=database_url) as connection:
            updated = await StudentService(StudentRepository(connection)).update_student(
                teacher,
                student_ids[0],
                TeacherStudentUpdate(
                    name="오늘 생일 학생",
                    birth_date=seoul_today,
                    phone="01012345678",
                    guardian_phone="01098765432",
                    include_in_statistics=True,
                ),
            )
        assert updated.birth_date == seoul_today
    finally:
        await _cleanup_live_students(database_url, teacher_id, student_ids)
