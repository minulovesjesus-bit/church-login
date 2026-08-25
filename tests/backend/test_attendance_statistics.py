import os
from datetime import UTC, date, datetime
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import psycopg
import pytest
from pydantic import ValidationError

from backend.attendance.repository import AttendanceRepository
from backend.attendance.schemas import (
    AttendanceStatusFilter,
    CurrentPresenceFilters,
    PaginationFilters,
    TeacherAttendanceFilters,
    TeacherStatisticsFilters,
)
from backend.attendance.service import AttendanceService
from backend.core.clock import FrozenClock
from backend.core.config import settings
from backend.core.db import application_transaction
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser


class UnusedQrService:
    async def verify_qr_challenge(self, _token: str):
        raise AssertionError("statistics must not verify a QR token")


class MissingAccessRepository:
    async def student_exists(self, _user_id: UUID) -> bool:
        return False

    async def staff_role(self, _user_id: UUID) -> str | None:
        return None


def _loopback_database_url() -> str:
    database_url = os.environ.get("TEST_DATABASE_URL") or settings.database_url
    if not database_url or urlsplit(database_url).hostname not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        pytest.skip("A loopback TEST_DATABASE_URL is required")
    return database_url


def _user(user_id: UUID, *, teacher: bool = False) -> AuthenticatedUser:
    return AuthenticatedUser(
        user_id=user_id,
        email=f"{'teacher' if teacher else 'student'}-{user_id.hex}@example.com",
        provider="google" if teacher else "password",
        email_verified=True,
    )


async def _seed_statistics_data(
    database_url: str,
    *,
    excluded_id: UUID,
    included_id: UUID,
    teacher_id: UUID,
) -> None:
    connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        async with connection.cursor() as cursor:
            await cursor.executemany(
                "insert into auth.users (id) values (%s)",
                [(excluded_id,), (included_id,), (teacher_id,)],
            )
        await connection.execute(
            """
            insert into app.user_profiles (user_id, email, name, phone)
            values
              (%s, %s, %s, '01011112222'),
              (%s, %s, '포함 학생', '01033334444'),
              (%s, %s, '통계 교사', '01055556666')
            """,
            (
                excluded_id,
                f"excluded-{excluded_id.hex}@example.com",
                "제외%학생",
                included_id,
                f"included-{included_id.hex}@example.com",
                teacher_id,
                f"teacher-{teacher_id.hex}@example.com",
            ),
        )
        await connection.execute(
            """
            insert into app.student_profiles (
              user_id, birth_date, guardian_phone, include_in_statistics
            ) values
              (%s, '2012-01-02', '01077778888', false),
              (%s, '2011-03-04', '01099990000', true)
            """,
            (excluded_id, included_id),
        )
        await connection.execute(
            "insert into app.staff_memberships (user_id, role) values (%s, 'teacher')",
            (teacher_id,),
        )

        scans = [
            # This open IN must never pair with the next Seoul day's first OUT.
            (excluded_id, date(2026, 8, 20), "IN", datetime(2026, 8, 20, 14, 30, tzinfo=UTC), None),
            (excluded_id, date(2026, 8, 21), "OUT", datetime(2026, 8, 20, 15, 30, tzinfo=UTC), None),
            (excluded_id, date(2026, 8, 21), "IN", datetime(2026, 8, 21, 0, 0, tzinfo=UTC), None),
            (excluded_id, date(2026, 8, 21), "OUT", datetime(2026, 8, 21, 1, 0, tzinfo=UTC), None),
            (excluded_id, date(2026, 8, 21), "IN", datetime(2026, 8, 21, 2, 0, tzinfo=UTC), None),
            # A voided pair is visible in detail but never affects statistics.
            (excluded_id, date(2026, 8, 21), "IN", datetime(2026, 8, 21, 3, 0, tzinfo=UTC), "잘못된 기록"),
            (excluded_id, date(2026, 8, 21), "OUT", datetime(2026, 8, 21, 8, 0, tzinfo=UTC), "잘못된 기록"),
            # The only aggregate-eligible student has one completed two-hour stay.
            (included_id, date(2026, 8, 21), "IN", datetime(2026, 8, 21, 0, 30, tzinfo=UTC), None),
            (included_id, date(2026, 8, 21), "OUT", datetime(2026, 8, 21, 2, 30, tzinfo=UTC), None),
        ]
        for student_id, attendance_date, direction, scanned_at, void_reason in scans:
            voided_at = datetime(2026, 8, 21, 9, tzinfo=UTC) if void_reason else None
            await connection.execute(
                """
                insert into app.attendance_scans (
                  student_id, attendance_date, direction, scanned_at,
                  request_id, source, recorded_by,
                  voided_at, voided_by, void_reason
                ) values (%s, %s, %s, %s, %s, 'MANUAL', %s, %s, %s, %s)
                """,
                (
                    student_id,
                    attendance_date,
                    direction,
                    scanned_at,
                    uuid4(),
                    teacher_id,
                    voided_at,
                    teacher_id if voided_at else None,
                    void_reason,
                ),
            )
        await connection.commit()
    finally:
        await connection.close()


async def _cleanup_statistics_data(
    database_url: str, user_ids: list[UUID]
) -> None:
    connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        await connection.execute(
            "delete from app.audit_logs where actor_id = any(%s)", (user_ids,)
        )
        await connection.execute(
            "delete from app.attendance_scans where student_id = any(%s)",
            (user_ids,),
        )
        await connection.execute(
            "delete from app.staff_memberships where user_id = any(%s)", (user_ids,)
        )
        await connection.execute(
            "delete from app.student_profiles where user_id = any(%s)", (user_ids,)
        )
        await connection.execute(
            "delete from app.user_profiles where user_id = any(%s)", (user_ids,)
        )
        await connection.execute("delete from auth.users where id = any(%s)", (user_ids,))
        await connection.commit()
    finally:
        await connection.close()


def test_teacher_filters_are_bounded_and_normalize_search() -> None:
    with pytest.raises(ValidationError):
        TeacherStatisticsFilters(
            date_from=date(2025, 1, 1),
            date_to=date(2026, 8, 21),
        )
    with pytest.raises(ValidationError):
        TeacherAttendanceFilters(
            date_from=date(2026, 8, 22),
            date_to=date(2026, 8, 21),
        )

    filters = TeacherAttendanceFilters(
        date_from=date(2026, 8, 21),
        date_to=date(2026, 8, 21),
        search="  김   학생  ",
        page=2,
        page_size=10,
    )
    assert filters.search == "김 학생"


async def test_history_and_statistics_require_active_role_records() -> None:
    service = AttendanceService(
        MissingAccessRepository(),  # type: ignore[arg-type]
        UnusedQrService(),
        clock=FrozenClock(datetime(2026, 8, 21, 3, tzinfo=UTC)),
        rate_limit_secret="statistics-test-secret",
    )
    student = _user(uuid4())
    former_teacher = _user(uuid4(), teacher=True)

    with pytest.raises(ApiError) as missing_profile:
        await service.student_summary(student)
    with pytest.raises(ApiError) as missing_membership:
        await service.teacher_summary(
            former_teacher,
            TeacherStatisticsFilters(
                date_from=date(2026, 8, 1), date_to=date(2026, 8, 21)
            ),
        )
    with pytest.raises(ApiError) as missing_presence_membership:
        await service.current_presence(
            former_teacher,
            CurrentPresenceFilters(),
        )

    assert missing_profile.value.code == "PROFILE_REQUIRED"
    assert missing_membership.value.code == "FORBIDDEN"
    assert missing_presence_membership.value.code == "FORBIDDEN"


async def test_personal_statistics_pair_only_within_seoul_date_and_ignore_voids() -> None:
    database_url = _loopback_database_url()
    excluded_id, included_id, teacher_id = uuid4(), uuid4(), uuid4()
    await _seed_statistics_data(
        database_url,
        excluded_id=excluded_id,
        included_id=included_id,
        teacher_id=teacher_id,
    )
    clock = FrozenClock(datetime(2026, 8, 21, 3, 30, tzinfo=UTC))
    try:
        async with application_transaction(database_url=database_url) as connection:
            service = AttendanceService(
                AttendanceRepository(connection),
                UnusedQrService(),
                clock=clock,
                rate_limit_secret="statistics-test-secret",
            )
            summary = await service.student_summary(_user(excluded_id))
            history = await service.student_history(
                _user(excluded_id), PaginationFilters(page=1, page_size=100)
            )

        assert summary.attendance_days_this_week == 2
        assert summary.attendance_days_this_month == 2
        assert summary.total_entries == 3
        assert summary.average_stay_seconds == pytest.approx(3600)
        assert summary.currently_inside is True
        assert summary.open_stay_started_at == datetime(2026, 8, 21, 2, tzinfo=UTC)
        assert summary.as_of_date == date(2026, 8, 21)
        assert history.total == 7
        assert sum(item.voided_at is not None for item in history.items) == 2
    finally:
        await _cleanup_statistics_data(
            database_url, [excluded_id, included_id, teacher_id]
        )


async def test_teacher_aggregate_excludes_flagged_student_but_detail_keeps_them() -> None:
    database_url = _loopback_database_url()
    excluded_id, included_id, teacher_id = uuid4(), uuid4(), uuid4()
    await _seed_statistics_data(
        database_url,
        excluded_id=excluded_id,
        included_id=included_id,
        teacher_id=teacher_id,
    )
    teacher = _user(teacher_id, teacher=True)
    clock = FrozenClock(datetime(2026, 8, 21, 3, 30, tzinfo=UTC))
    date_filters = TeacherStatisticsFilters(
        date_from=date(2026, 8, 20), date_to=date(2026, 8, 21)
    )
    try:
        async with application_transaction(database_url=database_url) as connection:
            service = AttendanceService(
                AttendanceRepository(connection),
                UnusedQrService(),
                clock=clock,
                rate_limit_secret="statistics-test-secret",
            )
            summary = await service.teacher_summary(teacher, date_filters)
            beyond_last_page = await service.teacher_summary(
                teacher,
                TeacherStatisticsFilters(
                    date_from=date(2026, 8, 20),
                    date_to=date(2026, 8, 21),
                    page=2,
                    page_size=1,
                ),
            )
            excluded_detail = await service.teacher_history(
                teacher,
                TeacherAttendanceFilters(
                    date_from=date(2026, 8, 20),
                    date_to=date(2026, 8, 21),
                    search="%",
                    page_size=100,
                ),
            )
            voided_page = await service.teacher_history(
                teacher,
                TeacherAttendanceFilters(
                    date_from=date(2026, 8, 20),
                    date_to=date(2026, 8, 21),
                    status=AttendanceStatusFilter.VOIDED,
                    page=1,
                    page_size=1,
                ),
            )
            empty = await service.teacher_summary(
                teacher,
                TeacherStatisticsFilters(
                    date_from=date(2026, 8, 20),
                    date_to=date(2026, 8, 21),
                    search="존재하지 않음",
                ),
            )
            current_presence = await service.current_presence(
                teacher,
                CurrentPresenceFilters(query="제외%학생", page_size=1),
            )
            current_presence_beyond_page = await service.current_presence(
                teacher,
                CurrentPresenceFilters(query="제외%학생", page=2, page_size=1),
            )

        assert summary.unique_students_today == 1
        assert summary.unique_students_this_week == 1
        assert summary.unique_students_this_month == 1
        assert summary.currently_inside == 0
        assert summary.average_stay_seconds == pytest.approx(7200)
        assert summary.student_attendance_days[0].student_id == included_id
        assert summary.student_attendance_days[0].attendance_days == 1
        assert summary.student_attendance_days_total == 1
        assert summary.student_attendance_days_page == 1
        assert beyond_last_page.student_attendance_days == []
        assert beyond_last_page.student_attendance_days_total == 1
        assert beyond_last_page.student_attendance_days_page == 2
        assert {entry.hour: entry.entries for entry in summary.time_of_day_entries} == {9: 1}

        # Percent is treated literally, not as an ILIKE wildcard.
        assert excluded_detail.total == 7
        assert {item.student_id for item in excluded_detail.items} == {excluded_id}
        assert all(item.excluded_from_statistics for item in excluded_detail.items)
        assert voided_page.total == 2
        assert len(voided_page.items) == 1
        assert voided_page.items[0].voided_at is not None

        assert empty.unique_students_today == 0
        assert empty.average_stay_seconds is None
        assert empty.time_of_day_entries == []
        assert empty.student_attendance_days == []
        assert empty.student_attendance_days_total == 0

        assert current_presence.total == 1
        assert current_presence.as_of_date == date(2026, 8, 21)
        assert len(current_presence.items) == 1
        present = current_presence.items[0]
        assert present.student_id == excluded_id
        assert present.student_name == "제외%학생"
        assert present.student_phone == "01011112222"
        assert present.guardian_phone == "01077778888"
        assert present.birth_date == date(2012, 1, 2)
        assert present.checked_in_at == datetime(2026, 8, 21, 2, tzinfo=UTC)
        assert present.source.value == "MANUAL"
        assert present.excluded_from_statistics is True
        assert current_presence_beyond_page.items == []
        assert current_presence_beyond_page.total == 1
    finally:
        await _cleanup_statistics_data(
            database_url, [excluded_id, included_id, teacher_id]
        )
