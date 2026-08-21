import os
from datetime import UTC, date, datetime
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
import psycopg
import pytest

from backend.attendance.models import Direction, Source
from backend.attendance.repository import AttendanceRepository
from backend.attendance.schemas import (
    TeacherAttendanceItem,
    TeacherAttendancePage,
    TeacherStatisticsView,
)
from backend.core.auth import get_current_user
from backend.core.clock import FrozenClock
from backend.core.config import settings
from backend.dashboard.router import get_dashboard_service, router
from backend.dashboard.schemas import TeacherDashboardView
from backend.dashboard.service import DashboardService
from backend.identity.models import AuthenticatedUser
from backend.identity.router import get_identity_repository, require_teacher
from backend.main import app
from backend.students.repository import StudentRepository


def _user(*, admin: bool = False) -> AuthenticatedUser:
    return AuthenticatedUser(
        user_id=uuid4(),
        email="admin@example.test" if admin else "teacher@example.test",
        provider="google",
        email_verified=True,
    )


def _recent(index: int, *, excluded: bool = False) -> TeacherAttendanceItem:
    return TeacherAttendanceItem(
        id=UUID(f"00000000-0000-4000-8000-{index:012d}"),
        student_id=UUID(f"00000000-0000-4000-8001-{index:012d}"),
        attendance_date=date(2026, 8, 24),
        direction=Direction.IN,
        scanned_at=datetime(2026, 8, 24, 1, index, tzinfo=UTC),
        source=Source.QR,
        recorded_by=None,
        voided_at=None,
        voided_by=None,
        void_reason=None,
        student_name=f"학생 {index}",
        student_email=f"student{index}@example.test",
        excluded_from_statistics=excluded,
    )


class FakeAttendanceRepository:
    def __init__(self) -> None:
        self.statistics_calls = []
        self.history_calls = []

    async def teacher_statistics(self, filters, **boundaries):
        self.statistics_calls.append((filters, boundaries))
        return TeacherStatisticsView(
            unique_students_today=4,
            unique_students_this_week=8,
            unique_students_this_month=9,
            currently_inside=3,
            average_stay_seconds=None,
            time_of_day_entries=[],
            student_attendance_days=[],
            student_attendance_days_total=0,
            student_attendance_days_page=filters.page,
            student_attendance_days_page_size=filters.page_size,
            date_from=filters.date_from,
            date_to=filters.date_to,
            as_of_date=boundaries["as_of_date"],
        )

    async def teacher_history(self, filters):
        self.history_calls.append(filters)
        return TeacherAttendancePage(
            items=[_recent(index, excluded=index == 10) for index in range(10, 0, -1)],
            total=11,
            page=filters.page,
            page_size=filters.page_size,
        )


class FakeStudentRepository:
    async def count_statistics_target_students(self) -> int:
        return 23


class FakeDashboardService:
    async def teacher_dashboard(self) -> TeacherDashboardView:
        return TeacherDashboardView(
            today_attendees=4,
            currently_inside=3,
            week_attendees=8,
            statistics_target_students=23,
            recent_attendance=[_recent(1, excluded=True)],
            as_of_date=date(2026, 8, 24),
        )


class FakeIdentityRepository:
    def __init__(self, role: str | None) -> None:
        self.role = role

    async def bootstrap_initial_admin(self, _user: AuthenticatedUser) -> bool:
        return False

    async def staff_role(self, _user_id: UUID) -> str | None:
        return self.role


async def test_teacher_dashboard_route_is_registered_once_and_protected(
    client: httpx.AsyncClient,
) -> None:
    assert [route.path for route in router.routes].count("/api/teacher/dashboard") == 1
    assert sum(getattr(route, "original_router", None) is router for route in app.routes) == 1

    response = await client.get("/api/teacher/dashboard")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


@pytest.mark.parametrize("role", ["teacher", "admin"])
async def test_teacher_and_admin_receive_the_exact_bounded_response(
    client: httpx.AsyncClient,
    role: str,
) -> None:
    actor = _user(admin=role == "admin")

    async def current_staff() -> AuthenticatedUser:
        return actor

    app.dependency_overrides[require_teacher] = current_staff
    app.dependency_overrides[get_dashboard_service] = FakeDashboardService
    try:
        response = await client.get("/api/teacher/dashboard")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "today_attendees": 4,
        "currently_inside": 3,
        "week_attendees": 8,
        "statistics_target_students": 23,
        "recent_attendance": [
            {
                "id": "00000000-0000-4000-8000-000000000001",
                "student_id": "00000000-0000-4000-8001-000000000001",
                "attendance_date": "2026-08-24",
                "direction": "IN",
                "scanned_at": "2026-08-24T01:01:00Z",
                "source": "QR",
                "recorded_by": None,
                "voided_at": None,
                "voided_by": None,
                "void_reason": None,
                "student_name": "학생 1",
                "student_email": "student1@example.test",
                "excluded_from_statistics": True,
            }
        ],
        "as_of_date": "2026-08-24",
        "timezone": "Asia/Seoul",
    }


async def test_non_staff_google_user_is_rejected_by_the_existing_dependency(
    client: httpx.AsyncClient,
) -> None:
    actor = _user()

    async def current_user() -> AuthenticatedUser:
        return actor

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_identity_repository] = lambda: FakeIdentityRepository(None)
    try:
        response = await client.get("/api/teacher/dashboard")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


async def test_service_reuses_bounded_attendance_reads_at_seoul_week_boundary() -> None:
    attendance = FakeAttendanceRepository()
    service = DashboardService(
        attendance,  # type: ignore[arg-type]
        FakeStudentRepository(),  # type: ignore[arg-type]
        clock=FrozenClock(datetime(2026, 8, 23, 15, 30, tzinfo=UTC)),
    )

    result = await service.teacher_dashboard()

    assert result.as_of_date == date(2026, 8, 24)
    assert result.model_dump(exclude={"recent_attendance", "as_of_date", "timezone"}) == {
        "today_attendees": 4,
        "currently_inside": 3,
        "week_attendees": 8,
        "statistics_target_students": 23,
    }
    assert len(result.recent_attendance) == 10
    assert [item.id for item in result.recent_attendance] == [_recent(index).id for index in range(10, 0, -1)]
    statistics_filters, boundaries = attendance.statistics_calls[0]
    assert statistics_filters.date_from == date(2026, 8, 24)
    assert statistics_filters.date_to == date(2026, 8, 24)
    assert statistics_filters.page_size == 1
    assert boundaries == {
        "as_of_date": date(2026, 8, 24),
        "week_start": date(2026, 8, 24),
        "month_start": date(2026, 8, 1),
    }
    assert attendance.history_calls[0].page_size == 10
    assert attendance.history_calls[0].page == 1


async def test_dashboard_dependencies_share_the_function_connection() -> None:
    connection = object()

    service = await get_dashboard_service(connection)

    assert service._attendance_repository.connection is connection
    assert service._student_repository.connection is connection


def _loopback_database_url() -> str:
    database_url = os.environ.get("TEST_DATABASE_URL") or settings.database_url
    if not database_url or urlsplit(database_url).hostname not in {"127.0.0.1", "localhost", "::1"}:
        pytest.skip("A loopback TEST_DATABASE_URL is required")
    return database_url


async def test_live_dashboard_excludes_flagged_aggregates_but_keeps_recent_detail() -> None:
    database_url = _loopback_database_url()
    included_id, excluded_id, recorder_id = uuid4(), uuid4(), uuid4()
    connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        before_cursor = await connection.execute(
            "select count(*) from app.student_profiles where include_in_statistics"
        )
        before = int((await before_cursor.fetchone())[0])
        async with connection.cursor() as cursor:
            await cursor.executemany(
                "insert into auth.users (id) values (%s)",
                [(included_id,), (excluded_id,), (recorder_id,)],
            )
        await connection.execute(
            """
            insert into app.user_profiles (user_id, email, name, phone) values
              (%s, %s, '포함 학생', '01011112222'),
              (%s, %s, '제외 학생', '01033334444'),
              (%s, %s, '기록 교사', '01099990000')
            """,
            (
                included_id, f"included-{included_id.hex}@example.test",
                excluded_id, f"excluded-{excluded_id.hex}@example.test",
                recorder_id, f"teacher-{recorder_id.hex}@example.test",
            ),
        )
        await connection.execute(
            """
            insert into app.student_profiles (user_id, birth_date, guardian_phone, include_in_statistics) values
              (%s, '2012-01-01', '01055556666', true),
              (%s, '2012-01-02', '01077778888', false)
            """,
            (included_id, excluded_id),
        )
        await connection.execute(
            "insert into app.staff_memberships (user_id, role) values (%s, 'teacher')",
            (recorder_id,),
        )
        for student_id, direction, scanned_at in (
            (included_id, "IN", datetime(2026, 8, 24, 0, 0, tzinfo=UTC)),
            (excluded_id, "IN", datetime(2026, 8, 24, 0, 30, tzinfo=UTC)),
            (excluded_id, "OUT", datetime(2026, 8, 24, 1, 0, tzinfo=UTC)),
        ):
            await connection.execute(
                """
                insert into app.attendance_scans (
                  student_id, attendance_date, direction, scanned_at,
                  request_id, source, recorded_by
                ) values (%s, '2026-08-24', %s, %s, %s, 'MANUAL', %s)
                """,
                (student_id, direction, scanned_at, uuid4(), recorder_id),
            )

        service = DashboardService(
            AttendanceRepository(connection),
            StudentRepository(connection),
            clock=FrozenClock(datetime(2026, 8, 24, 3, 0, tzinfo=UTC)),
        )
        dashboard = await service.teacher_dashboard()

        assert dashboard.today_attendees == 1
        assert dashboard.week_attendees == 1
        assert dashboard.currently_inside == 1
        assert dashboard.statistics_target_students == before + 1
        assert {item.student_id for item in dashboard.recent_attendance} >= {included_id, excluded_id}
        excluded_rows = [item for item in dashboard.recent_attendance if item.student_id == excluded_id]
        assert excluded_rows and all(item.excluded_from_statistics for item in excluded_rows)
        assert [item.scanned_at for item in dashboard.recent_attendance] == sorted(
            [item.scanned_at for item in dashboard.recent_attendance], reverse=True
        )
    finally:
        await connection.rollback()
        await connection.close()
