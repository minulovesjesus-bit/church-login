from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from backend.attendance.models import AttendanceScan, Direction, Source
from backend.attendance.schemas import (
    AttendanceHistoryPage,
    AttendanceScanView,
    CorrectionMode,
    PaginationFilters,
    StudentAttendanceDays,
    StudentStatisticsView,
    TeacherAttendanceFilters,
    TeacherAttendanceItem,
    TeacherAttendancePage,
    TeacherStatisticsFilters,
    TeacherStatisticsView,
    TimeOfDayEntry,
)
from backend.core.rate_limit import ATTENDANCE_SCAN_RATE_LIMIT

SCAN_COLUMNS = """
id, student_id, attendance_date, direction::text, scanned_at,
kiosk_session_id, request_id, qr_issued_at, source::text, recorded_by,
voided_at, voided_by, void_reason
"""


class AttendanceRepository:
    def __init__(self, connection: Any) -> None:
        self.connection = connection

    async def student_exists(self, student_id: UUID) -> bool:
        cursor = await self.connection.execute(
            "select exists(select 1 from app.student_profiles where user_id = %s)",
            (student_id,),
        )
        row = await cursor.fetchone()
        return bool(row and row[0])

    async def student_history(
        self, student_id: UUID, filters: PaginationFilters
    ) -> AttendanceHistoryPage:
        count_cursor = await self.connection.execute(
            "select count(*) from app.attendance_scans where student_id = %s",
            (student_id,),
        )
        count_row = await count_cursor.fetchone()
        total = int(count_row[0]) if count_row is not None else 0
        cursor = await self.connection.execute(
            f"""
            select {SCAN_COLUMNS}
            from app.attendance_scans
            where student_id = %s
            order by scanned_at desc, id desc
            limit %s offset %s
            """,
            (
                student_id,
                filters.page_size,
                (filters.page - 1) * filters.page_size,
            ),
        )
        scans = [self._scan(row) for row in await cursor.fetchall()]
        return AttendanceHistoryPage(
            items=[
                AttendanceScanView.model_validate(scan)
                for scan in scans
                if scan is not None
            ],
            total=total,
            page=filters.page,
            page_size=filters.page_size,
        )

    async def student_statistics(
        self,
        student_id: UUID,
        *,
        as_of_date: date,
        week_start: date,
        month_start: date,
    ) -> StudentStatisticsView:
        cursor = await self.connection.execute(
            """
            with accepted as (
              select id, attendance_date, direction, scanned_at
              from app.attendance_scans
              where student_id = %(student_id)s
                and voided_at is null
            ), ordered as (
              select attendance_date, direction, scanned_at,
                     lead(direction) over (
                       partition by attendance_date
                       order by scanned_at, id
                     ) as next_direction,
                     lead(scanned_at) over (
                       partition by attendance_date
                       order by scanned_at, id
                     ) as next_scanned_at
              from accepted
            ), latest_today as (
              select direction, scanned_at
              from accepted
              where attendance_date = %(as_of_date)s
              order by scanned_at desc, id desc
              limit 1
            )
            select
              count(distinct attendance_date) filter (
                where direction = 'IN'
                  and attendance_date between %(week_start)s and %(as_of_date)s
              ),
              count(distinct attendance_date) filter (
                where direction = 'IN'
                  and attendance_date between %(month_start)s and %(as_of_date)s
              ),
              count(*) filter (where direction = 'IN'),
              (
                select avg(extract(epoch from next_scanned_at - scanned_at))
                from ordered
                where direction = 'IN' and next_direction = 'OUT'
              ),
              coalesce((select direction = 'IN' from latest_today), false),
              (
                select scanned_at from latest_today where direction = 'IN'
              )
            from accepted
            """,
            {
                "student_id": student_id,
                "as_of_date": as_of_date,
                "week_start": week_start,
                "month_start": month_start,
            },
        )
        row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("Student statistics query returned no row")
        return StudentStatisticsView(
            attendance_days_this_week=int(row[0] or 0),
            attendance_days_this_month=int(row[1] or 0),
            total_entries=int(row[2] or 0),
            average_stay_seconds=float(row[3]) if row[3] is not None else None,
            currently_inside=bool(row[4]),
            open_stay_started_at=row[5],
            as_of_date=as_of_date,
        )

    async def teacher_history(
        self, filters: TeacherAttendanceFilters
    ) -> TeacherAttendancePage:
        search_pattern = self._like_pattern(filters.search)
        parameters: dict[str, object] = {
            "date_from": filters.date_from,
            "date_to": filters.date_to,
            "status": filters.status.value,
            "search": search_pattern,
            "limit": filters.page_size,
            "offset": (filters.page - 1) * filters.page_size,
        }
        predicates = """
          scan.attendance_date between %(date_from)s and %(date_to)s
          and (
            %(status)s = 'ALL'
            or (%(status)s = 'VOIDED' and scan.voided_at is not null)
            or (
              %(status)s in ('IN', 'OUT')
              and scan.voided_at is null
              and scan.direction::text = %(status)s
            )
          )
          and (
            %(search)s::text is null
            or profile.name ilike %(search)s escape '\\'
            or profile.email ilike %(search)s escape '\\'
            or coalesce(profile.phone, '') ilike %(search)s escape '\\'
          )
        """
        count_cursor = await self.connection.execute(
            f"""
            select count(*)
            from app.attendance_scans scan
            join app.student_profiles student on student.user_id = scan.student_id
            join app.user_profiles profile on profile.user_id = scan.student_id
            where {predicates}
            """,
            parameters,
        )
        count_row = await count_cursor.fetchone()
        total = int(count_row[0]) if count_row is not None else 0
        cursor = await self.connection.execute(
            f"""
            select {', '.join(f'scan.{column.strip()}' for column in SCAN_COLUMNS.split(','))},
                   profile.name, profile.email, student.include_in_statistics
            from app.attendance_scans scan
            join app.student_profiles student on student.user_id = scan.student_id
            join app.user_profiles profile on profile.user_id = scan.student_id
            where {predicates}
            order by scan.scanned_at desc, scan.id desc
            limit %(limit)s offset %(offset)s
            """,
            parameters,
        )
        items: list[TeacherAttendanceItem] = []
        for row in await cursor.fetchall():
            scan = self._scan(row[:13])
            if scan is None:
                continue
            items.append(
                TeacherAttendanceItem(
                    **AttendanceScanView.model_validate(scan).model_dump(),
                    student_name=row[13],
                    student_email=row[14],
                    excluded_from_statistics=not bool(row[15]),
                )
            )
        return TeacherAttendancePage(
            items=items,
            total=total,
            page=filters.page,
            page_size=filters.page_size,
        )

    async def teacher_statistics(
        self,
        filters: TeacherStatisticsFilters,
        *,
        as_of_date: date,
        week_start: date,
        month_start: date,
    ) -> TeacherStatisticsView:
        parameters: dict[str, object] = {
            "date_from": filters.date_from,
            "date_to": filters.date_to,
            "search": self._like_pattern(filters.search),
            "as_of_date": as_of_date,
            "week_start": week_start,
            "month_start": month_start,
            "limit": filters.page_size,
            "offset": (filters.page - 1) * filters.page_size,
        }
        cursor = await self.connection.execute(
            """
            with matched_students as (
              select student.user_id, profile.name
              from app.student_profiles student
              join app.user_profiles profile on profile.user_id = student.user_id
              where student.include_in_statistics = true
                and (
                  %(search)s::text is null
                  or profile.name ilike %(search)s escape '\\'
                  or profile.email ilike %(search)s escape '\\'
                  or coalesce(profile.phone, '') ilike %(search)s escape '\\'
                )
            ), accepted_all as (
              select scan.id, scan.student_id, scan.attendance_date,
                     scan.direction, scan.scanned_at
              from app.attendance_scans scan
              join matched_students student on student.user_id = scan.student_id
              where scan.voided_at is null
                and (
                  scan.attendance_date between %(date_from)s and %(date_to)s
                  or scan.attendance_date between
                    least(%(week_start)s, %(month_start)s) and %(as_of_date)s
                )
            ), accepted as (
              select *
              from accepted_all
              where attendance_date between %(date_from)s and %(date_to)s
            ), ordered as (
              select student_id, attendance_date, direction, scanned_at,
                     lead(direction) over (
                       partition by student_id, attendance_date
                       order by scanned_at, id
                     ) as next_direction,
                     lead(scanned_at) over (
                       partition by student_id, attendance_date
                       order by scanned_at, id
                     ) as next_scanned_at
              from accepted
            ), latest_today as (
              select distinct on (student_id) student_id, direction
              from accepted_all
              where attendance_date = %(as_of_date)s
              order by student_id, scanned_at desc, id desc
            )
            select
              count(distinct student_id) filter (
                where direction = 'IN' and attendance_date = %(as_of_date)s
              ),
              count(distinct student_id) filter (
                where direction = 'IN'
                  and attendance_date between %(week_start)s and %(as_of_date)s
              ),
              count(distinct student_id) filter (
                where direction = 'IN'
                  and attendance_date between %(month_start)s and %(as_of_date)s
              ),
              (select count(*) from latest_today where direction = 'IN'),
              (
                select avg(extract(epoch from next_scanned_at - scanned_at))
                from ordered
                where direction = 'IN' and next_direction = 'OUT'
              )
            from accepted_all
            """,
            parameters,
        )
        row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("Teacher statistics query returned no row")

        hourly_cursor = await self.connection.execute(
            """
            select extract(hour from scan.scanned_at at time zone 'Asia/Seoul')::int,
                   count(*)
            from app.attendance_scans scan
            join app.student_profiles student on student.user_id = scan.student_id
            join app.user_profiles profile on profile.user_id = scan.student_id
            where scan.voided_at is null
              and scan.direction = 'IN'
              and student.include_in_statistics = true
              and scan.attendance_date between %(date_from)s and %(date_to)s
              and (
                %(search)s::text is null
                or profile.name ilike %(search)s escape '\\'
                or profile.email ilike %(search)s escape '\\'
                or coalesce(profile.phone, '') ilike %(search)s escape '\\'
              )
            group by 1
            order by 1
            """,
            parameters,
        )
        time_of_day_entries = [
            TimeOfDayEntry(hour=int(hour), entries=int(entries))
            for hour, entries in await hourly_cursor.fetchall()
        ]

        days_cursor = await self.connection.execute(
            """
            with student_days as (
              select scan.student_id, profile.name,
                     count(distinct scan.attendance_date) as attendance_days
              from app.attendance_scans scan
              join app.student_profiles student on student.user_id = scan.student_id
              join app.user_profiles profile on profile.user_id = scan.student_id
              where scan.voided_at is null
                and scan.direction = 'IN'
                and student.include_in_statistics = true
                and scan.attendance_date between %(date_from)s and %(date_to)s
                and (
                  %(search)s::text is null
                  or profile.name ilike %(search)s escape '\\'
                  or profile.email ilike %(search)s escape '\\'
                  or coalesce(profile.phone, '') ilike %(search)s escape '\\'
                )
              group by scan.student_id, profile.name
            )
            select page.student_id, page.name, page.attendance_days, totals.total
            from (select count(*) as total from student_days) totals
            left join lateral (
              select student_id, name, attendance_days
              from student_days
              order by attendance_days desc, name, student_id
              limit %(limit)s offset %(offset)s
            ) page on true
            order by page.attendance_days desc nulls last,
                     page.name nulls last,
                     page.student_id nulls last
            """,
            parameters,
        )
        days_rows = await days_cursor.fetchall()
        student_days = [
            StudentAttendanceDays(
                student_id=student_id,
                student_name=name,
                attendance_days=int(days),
            )
            for student_id, name, days, _total in days_rows
            if student_id is not None
        ]
        return TeacherStatisticsView(
            unique_students_today=int(row[0] or 0),
            unique_students_this_week=int(row[1] or 0),
            unique_students_this_month=int(row[2] or 0),
            currently_inside=int(row[3] or 0),
            average_stay_seconds=float(row[4]) if row[4] is not None else None,
            time_of_day_entries=time_of_day_entries,
            student_attendance_days=student_days,
            student_attendance_days_total=int(days_rows[0][3]),
            student_attendance_days_page=filters.page,
            student_attendance_days_page_size=filters.page_size,
            date_from=filters.date_from,
            date_to=filters.date_to,
            as_of_date=as_of_date,
        )

    async def scan_by_request(
        self, student_id: UUID, request_id: UUID
    ) -> AttendanceScan | None:
        cursor = await self.connection.execute(
            f"""
            select {SCAN_COLUMNS}
            from app.attendance_scans
            where student_id = %s and request_id = %s
            """,
            (student_id, request_id),
        )
        return self._scan(await cursor.fetchone())

    async def scan_by_id(self, scan_id: UUID) -> AttendanceScan | None:
        cursor = await self.connection.execute(
            f"""
            select {SCAN_COLUMNS}
            from app.attendance_scans
            where id = %s
            """,
            (scan_id,),
        )
        return self._scan(await cursor.fetchone())

    async def lock_student_date(self, student_id: UUID, attendance_date: date) -> None:
        lock_key = f"{student_id}:{attendance_date.isoformat()}"
        await self.connection.execute(
            "select pg_advisory_xact_lock(hashtextextended(%s, 0))", (lock_key,)
        )

    async def lock_student_request(self, student_id: UUID, request_id: UUID) -> None:
        lock_key = f"attendance-request:{student_id}:{request_id}"
        await self.connection.execute(
            "select pg_advisory_xact_lock(hashtextextended(%s, 1))", (lock_key,)
        )

    async def latest_non_voided_scan(
        self, student_id: UUID, attendance_date: date
    ) -> AttendanceScan | None:
        cursor = await self.connection.execute(
            f"""
            select {SCAN_COLUMNS}
            from app.attendance_scans
            where student_id = %s
              and attendance_date = %s
              and voided_at is null
            order by scanned_at desc, id desc
            limit 1
            """,
            (student_id, attendance_date),
        )
        return self._scan(await cursor.fetchone())

    async def insert_qr_scan(
        self,
        *,
        student_id: UUID,
        attendance_date: date,
        direction: Direction,
        scanned_at: datetime,
        kiosk_session_id: UUID,
        request_id: UUID,
        qr_issued_at: datetime,
    ) -> AttendanceScan | None:
        cursor = await self.connection.execute(
            f"""
            insert into app.attendance_scans (
              student_id, attendance_date, direction, scanned_at,
              kiosk_session_id, request_id, qr_issued_at, source
            ) values (%s, %s, %s, %s, %s, %s, %s, 'QR')
            on conflict (student_id, request_id) do nothing
            returning {SCAN_COLUMNS}
            """,
            (
                student_id,
                attendance_date,
                direction.value,
                scanned_at,
                kiosk_session_id,
                request_id,
                qr_issued_at,
            ),
        )
        return self._scan(await cursor.fetchone())

    async def consume_scan_rate_limit(self, key_hash: str, now: datetime) -> bool:
        policy = ATTENDANCE_SCAN_RATE_LIMIT
        cursor = await self.connection.execute(
            """
            insert into app.rate_limit_buckets (
              bucket_key_hash, action, window_started_at,
              attempt_count, blocked_until, updated_at
            ) values (%(key)s, %(action)s, %(now)s, 1, null, %(now)s)
            on conflict (bucket_key_hash, action) do update
            set window_started_at = case
                  when app.rate_limit_buckets.window_started_at + %(window)s <= %(now)s
                    then %(now)s
                  else app.rate_limit_buckets.window_started_at
                end,
                attempt_count = case
                  when app.rate_limit_buckets.window_started_at + %(window)s <= %(now)s
                    then 1
                  else app.rate_limit_buckets.attempt_count + 1
                end,
                blocked_until = case
                  when app.rate_limit_buckets.blocked_until > %(now)s
                    then app.rate_limit_buckets.blocked_until
                  when (
                    case
                      when app.rate_limit_buckets.window_started_at + %(window)s <= %(now)s
                        then 1
                      else app.rate_limit_buckets.attempt_count + 1
                    end
                  ) > %(limit)s
                    then %(now)s + %(block_for)s
                  else null
                end,
                updated_at = %(now)s
            returning blocked_until is null or blocked_until <= %(now)s
            """,
            {
                "key": key_hash,
                "action": policy.action,
                "now": now,
                "window": policy.window,
                "limit": policy.attempt_limit,
                "block_for": policy.block_for,
            },
        )
        row = await cursor.fetchone()
        return bool(row and row[0])

    async def lock_active_kiosk_session(
        self, kiosk_session_id: UUID, now: datetime
    ) -> bool:
        cursor = await self.connection.execute(
            """
            select id
            from app.kiosk_sessions
            where id = %s
              and revoked_at is null
              and refresh_expires_at > %s
            for share
            """,
            (kiosk_session_id, now),
        )
        return await cursor.fetchone() is not None

    async def staff_role(self, user_id: UUID) -> str | None:
        cursor = await self.connection.execute(
            """
            select role::text
            from app.staff_memberships
            where user_id = %s
            for share
            """,
            (user_id,),
        )
        row = await cursor.fetchone()
        return row[0] if row is not None else None

    async def void_scan(
        self, scan_id: UUID, *, actor_id: UUID, reason: str, now: datetime
    ) -> AttendanceScan | None:
        cursor = await self.connection.execute(
            f"""
            update app.attendance_scans
            set voided_at = %s, voided_by = %s, void_reason = %s
            where id = %s and voided_at is null
            returning {SCAN_COLUMNS}
            """,
            (now, actor_id, reason, scan_id),
        )
        return self._scan(await cursor.fetchone())

    async def insert_manual_scan(
        self,
        *,
        student_id: UUID,
        direction: Direction,
        scanned_at: datetime,
        actor_id: UUID,
    ) -> AttendanceScan:
        attendance_date = scanned_at.astimezone(ZoneInfo("Asia/Seoul")).date()
        cursor = await self.connection.execute(
            f"""
            insert into app.attendance_scans (
              student_id, attendance_date, direction, scanned_at,
              request_id, source, recorded_by
            ) values (%s, %s, %s, %s, %s, 'MANUAL', %s)
            returning {SCAN_COLUMNS}
            """,
            (
                student_id,
                attendance_date,
                direction.value,
                scanned_at,
                uuid4(),
                actor_id,
            ),
        )
        scan = self._scan(await cursor.fetchone())
        if scan is None:
            raise RuntimeError("Manual attendance insert returned no row")
        return scan

    async def append_correction_audit(
        self,
        *,
        actor_id: UUID,
        mode: CorrectionMode,
        scan_id: UUID,
        details: dict[str, object],
    ) -> None:
        await self.connection.execute(
            """
            insert into app.audit_logs (
              actor_id, action, target_type, target_id, details
            ) values (%s, 'attendance.corrected', 'attendance_scan', %s, %s)
            """,
            (actor_id, str(scan_id), Jsonb(details)),
        )

    @staticmethod
    def _like_pattern(search: str | None) -> str | None:
        if search is None:
            return None
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        return f"%{escaped}%"

    @staticmethod
    def _scan(row: Any | None) -> AttendanceScan | None:
        if row is None:
            return None
        return AttendanceScan(
            id=row[0],
            student_id=row[1],
            attendance_date=row[2],
            direction=Direction(row[3]),
            scanned_at=row[4],
            kiosk_session_id=row[5],
            request_id=row[6],
            qr_issued_at=row[7],
            source=Source(row[8]),
            recorded_by=row[9],
            voided_at=row[10],
            voided_by=row[11],
            void_reason=row[12],
        )
