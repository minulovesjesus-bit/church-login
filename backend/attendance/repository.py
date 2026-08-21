from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from backend.attendance.models import AttendanceScan, Direction, Source
from backend.attendance.schemas import CorrectionMode
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
