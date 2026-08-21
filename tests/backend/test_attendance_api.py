from datetime import UTC, date, datetime
from uuid import uuid4

import httpx

from backend.attendance.models import Direction, Source
from backend.attendance.router import get_attendance_service, router
from backend.attendance.schemas import (
    AttendanceHistoryPage,
    AttendanceScanView,
    PaginationFilters,
    StudentStatisticsView,
    TeacherAttendanceFilters,
    TeacherAttendancePage,
    TeacherStatisticsFilters,
    TeacherStatisticsView,
)
from backend.core.auth import get_current_user
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.router import require_teacher
from backend.main import app


class FakeHistoryService:
    def __init__(self) -> None:
        self.student_history_calls: list[
            tuple[AuthenticatedUser, PaginationFilters]
        ] = []
        self.student_summary_calls: list[AuthenticatedUser] = []
        self.teacher_history_calls: list[
            tuple[AuthenticatedUser, TeacherAttendanceFilters]
        ] = []
        self.teacher_summary_calls: list[
            tuple[AuthenticatedUser, TeacherStatisticsFilters]
        ] = []
        self.now = datetime(2026, 8, 21, 3, tzinfo=UTC)

    async def student_history(
        self, user: AuthenticatedUser, filters: PaginationFilters
    ) -> AttendanceHistoryPage:
        self.student_history_calls.append((user, filters))
        return AttendanceHistoryPage(
            items=[
                AttendanceScanView(
                    id=uuid4(),
                    student_id=user.user_id,
                    attendance_date=date(2026, 8, 21),
                    direction=Direction.IN,
                    scanned_at=self.now,
                    source=Source.QR,
                    recorded_by=None,
                    voided_at=None,
                    voided_by=None,
                    void_reason=None,
                )
            ],
            total=1,
            page=filters.page,
            page_size=filters.page_size,
        )

    async def student_summary(
        self, user: AuthenticatedUser
    ) -> StudentStatisticsView:
        self.student_summary_calls.append(user)
        return StudentStatisticsView(
            attendance_days_this_week=1,
            attendance_days_this_month=1,
            total_entries=1,
            average_stay_seconds=None,
            currently_inside=True,
            open_stay_started_at=self.now,
            as_of_date=date(2026, 8, 21),
        )

    async def teacher_history(
        self, user: AuthenticatedUser, filters: TeacherAttendanceFilters
    ) -> TeacherAttendancePage:
        self.teacher_history_calls.append((user, filters))
        return TeacherAttendancePage(
            items=[], total=0, page=filters.page, page_size=filters.page_size
        )

    async def teacher_summary(
        self, user: AuthenticatedUser, filters: TeacherStatisticsFilters
    ) -> TeacherStatisticsView:
        self.teacher_summary_calls.append((user, filters))
        return TeacherStatisticsView(
            unique_students_today=0,
            unique_students_this_week=0,
            unique_students_this_month=0,
            currently_inside=0,
            average_stay_seconds=None,
            time_of_day_entries=[],
            student_attendance_days=[],
            student_attendance_days_total=1,
            student_attendance_days_page=filters.page,
            student_attendance_days_page_size=filters.page_size,
            date_from=filters.date_from,
            date_to=filters.date_to,
            as_of_date=date(2026, 8, 21),
        )


def test_attendance_history_and_statistics_routes_are_registered() -> None:
    paths = {route.path for route in router.routes}

    assert "/api/attendance/me" in paths
    assert "/api/statistics/me" in paths
    assert "/api/teacher/attendance" in paths
    assert "/api/teacher/statistics" in paths


async def test_student_endpoints_derive_subject_and_bound_pagination(
    client: httpx.AsyncClient,
) -> None:
    student = AuthenticatedUser(
        user_id=uuid4(),
        email="student@example.com",
        provider="password",
        email_verified=True,
    )
    service = FakeHistoryService()

    async def current_student() -> AuthenticatedUser:
        return student

    app.dependency_overrides[get_current_user] = current_student
    app.dependency_overrides[get_attendance_service] = lambda: service
    try:
        history = await client.get("/api/attendance/me?page=2&page_size=5")
        summary = await client.get(
            f"/api/statistics/me?student_id={uuid4()}"
        )
        invalid = await client.get("/api/attendance/me?page_size=101")
        attempted_idor = await client.get(
            f"/api/attendance/me?student_id={uuid4()}"
        )
    finally:
        app.dependency_overrides.clear()

    assert history.status_code == 200
    assert history.json()["page"] == 2
    assert history.json()["items"][0]["student_id"] == str(student.user_id)
    assert summary.status_code == 200
    assert summary.json()["currently_inside"] is True
    assert service.student_history_calls[0] == (
        student,
        PaginationFilters(page=2, page_size=5),
    )
    assert service.student_summary_calls == [student]
    assert invalid.status_code == 422
    assert attempted_idor.status_code == 422


async def test_teacher_endpoints_require_teacher_and_validate_filters(
    client: httpx.AsyncClient,
) -> None:
    teacher = AuthenticatedUser(
        user_id=uuid4(),
        email="teacher@example.com",
        provider="google",
        email_verified=True,
    )
    service = FakeHistoryService()
    app.dependency_overrides[get_attendance_service] = lambda: service
    try:
        unauthenticated = await client.get(
            "/api/teacher/attendance?date_from=2026-08-01&date_to=2026-08-21"
        )

        async def current_teacher() -> AuthenticatedUser:
            return teacher

        app.dependency_overrides[require_teacher] = current_teacher
        history = await client.get(
            "/api/teacher/attendance"
            "?date_from=2026-08-01&date_to=2026-08-21"
            "&status=IN&search=%20%20%EA%B9%80%20%20%ED%95%99%EC%83%9D%20%20"
            "&page=3&page_size=10"
        )
        statistics = await client.get(
            "/api/teacher/statistics"
            "?date_from=2026-08-01&date_to=2026-08-21&search=%25"
            "&page=2&page_size=5"
        )
        invalid_range = await client.get(
            "/api/teacher/statistics"
            "?date_from=2025-01-01&date_to=2026-08-21"
        )
    finally:
        app.dependency_overrides.clear()

    assert unauthenticated.status_code == 401
    assert history.status_code == 200
    _, filters = service.teacher_history_calls[0]
    assert filters.search == "김 학생"
    assert filters.status.value == "IN"
    assert filters.page == 3
    assert statistics.status_code == 200
    assert service.teacher_summary_calls[0][1].search == "%"
    assert service.teacher_summary_calls[0][1].page == 2
    assert statistics.json()["student_attendance_days_page_size"] == 5
    assert statistics.json()["student_attendance_days"] == []
    assert statistics.json()["student_attendance_days_total"] == 1
    assert invalid_range.status_code == 422


async def test_history_response_waits_for_function_scoped_transaction(
    client: httpx.AsyncClient,
) -> None:
    student = AuthenticatedUser(
        user_id=uuid4(),
        email="student@example.com",
        provider="password",
        email_verified=True,
    )
    service = FakeHistoryService()

    async def current_student() -> AuthenticatedUser:
        return student

    async def failing_transaction_service():
        yield service
        raise ApiError("DATABASE_UNAVAILABLE", "잠시 후 다시 시도해 주세요.", 503)

    app.dependency_overrides[get_current_user] = current_student
    app.dependency_overrides[get_attendance_service] = failing_transaction_service
    try:
        response = await client.get("/api/attendance/me")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
