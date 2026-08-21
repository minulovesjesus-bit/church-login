from datetime import timedelta
from zoneinfo import ZoneInfo

from backend.attendance.repository import AttendanceRepository
from backend.attendance.schemas import (
    TeacherAttendanceFilters,
    TeacherStatisticsFilters,
)
from backend.core.clock import Clock, SystemClock
from backend.dashboard.schemas import TeacherDashboardView
from backend.students.repository import StudentRepository


class DashboardService:
    BUSINESS_TIMEZONE = ZoneInfo("Asia/Seoul")

    def __init__(
        self,
        attendance_repository: AttendanceRepository,
        student_repository: StudentRepository,
        *,
        clock: Clock | None = None,
    ) -> None:
        self._attendance_repository = attendance_repository
        self._student_repository = student_repository
        self._clock = clock or SystemClock()

    async def teacher_dashboard(self) -> TeacherDashboardView:
        as_of_date = self._clock.now().astimezone(self.BUSINESS_TIMEZONE).date()
        week_start = as_of_date - timedelta(days=as_of_date.weekday())
        month_start = as_of_date.replace(day=1)

        statistics = await self._attendance_repository.teacher_statistics(
            TeacherStatisticsFilters(
                date_from=week_start,
                date_to=as_of_date,
                page=1,
                page_size=1,
            ),
            as_of_date=as_of_date,
            week_start=week_start,
            month_start=month_start,
        )
        recent = await self._attendance_repository.teacher_history(
            TeacherAttendanceFilters(
                date_from=as_of_date - timedelta(days=365),
                date_to=as_of_date,
                page=1,
                page_size=10,
            )
        )
        target_count = await self._student_repository.count_statistics_target_students()

        return TeacherDashboardView(
            today_attendees=statistics.unique_students_today,
            currently_inside=statistics.currently_inside,
            week_attendees=statistics.unique_students_this_week,
            statistics_target_students=target_count,
            recent_attendance=recent.items,
            as_of_date=as_of_date,
        )
