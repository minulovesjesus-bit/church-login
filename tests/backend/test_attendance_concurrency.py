import asyncio
import hashlib
import hmac
import os
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import psycopg
import pytest

from backend.attendance.models import Direction
from backend.attendance.repository import AttendanceRepository
from backend.attendance.schemas import AttendanceCorrectionInput, CorrectionMode
from backend.attendance.service import AttendanceService, ScanRateLimited
from backend.core.clock import FrozenClock
from backend.core.config import settings
from backend.core.db import application_transaction
from backend.identity.models import AuthenticatedUser
from backend.kiosk.repository import KioskRepository
from backend.kiosk.service import (
    KioskSessionRevoked,
    KioskSessionService,
    QrChallengeExpired,
)

LIVE_RATE_LIMIT_SECRET = "live-rate-limit-secret"


def _loopback_database_url() -> str:
    database_url = os.environ.get("TEST_DATABASE_URL") or settings.database_url
    if not database_url or urlsplit(database_url).hostname not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        pytest.skip("A loopback TEST_DATABASE_URL is required")
    return database_url


def _student(user_id: UUID) -> AuthenticatedUser:
    return AuthenticatedUser(
        user_id=user_id,
        email=f"student-{user_id.hex}@example.com",
        provider="password",
        email_verified=True,
    )


def _scan_rate_limit_key(student_id: UUID) -> str:
    digest = hmac.new(
        LIVE_RATE_LIMIT_SECRET.encode(),
        f"attendance-scan\0{student_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"hmac-sha256:{digest}"


def _kiosk_service(
    connection: object, clock: FrozenClock, qr_secret: str
) -> KioskSessionService:
    return KioskSessionService(
        KioskRepository(connection),  # type: ignore[arg-type]
        password_hash="unused",
        cookie_secret="c" * 32,
        qr_signing_secret=qr_secret,
        clock=clock,
    )


async def _seed_attendance_principals(
    database_url: str,
    *,
    student_id: UUID,
    kiosk_id: UUID,
    clock: FrozenClock,
    teacher_id: UUID | None = None,
) -> None:
    connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        user_ids = [student_id] + ([teacher_id] if teacher_id is not None else [])
        async with connection.cursor() as cursor:
            await cursor.executemany(
                "insert into auth.users (id) values (%s)",
                [(user_id,) for user_id in user_ids],
            )
        await connection.execute(
            """
            insert into app.user_profiles (user_id, email, name)
            values (%s, %s, '학생')
            """,
            (student_id, f"student-{student_id.hex}@example.com"),
        )
        await connection.execute(
            """
            insert into app.student_profiles (user_id, birth_date, guardian_phone)
            values (%s, '2012-04-03', '01099998888')
            """,
            (student_id,),
        )
        if teacher_id is not None:
            await connection.execute(
                """
                insert into app.user_profiles (user_id, email, name)
                values (%s, %s, '교사')
                """,
                (teacher_id, f"teacher-{teacher_id.hex}@example.com"),
            )
            await connection.execute(
                """
                insert into app.staff_memberships (user_id, role)
                values (%s, 'teacher')
                """,
                (teacher_id,),
            )
        await connection.execute(
            """
            insert into app.kiosk_sessions (
              id, refresh_token_hash, created_at, last_seen_at, refresh_expires_at
            ) values (%s, %s, %s, %s, %s)
            """,
            (
                kiosk_id,
                uuid4().hex,
                clock.now(),
                clock.now(),
                clock.now() + timedelta(days=30),
            ),
        )
        await connection.commit()
    finally:
        await connection.close()


async def _cleanup_attendance_principals(
    database_url: str,
    *,
    student_id: UUID,
    kiosk_id: UUID,
    teacher_id: UUID | None = None,
) -> None:
    connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        await connection.execute(
            "delete from app.audit_logs where target_id in (select id::text from app.attendance_scans where student_id = %s)",
            (student_id,),
        )
        await connection.execute(
            "delete from app.attendance_scans where student_id = %s", (student_id,)
        )
        await connection.execute(
            """
            delete from app.rate_limit_buckets
            where bucket_key_hash = %s and action = 'attendance.scan'
            """,
            (_scan_rate_limit_key(student_id),),
        )
        await connection.execute("delete from app.kiosk_sessions where id = %s", (kiosk_id,))
        if teacher_id is not None:
            await connection.execute(
                "delete from app.staff_memberships where user_id = %s", (teacher_id,)
            )
        await connection.execute(
            "delete from app.student_profiles where user_id = %s", (student_id,)
        )
        await connection.execute(
            "delete from app.user_profiles where user_id = any(%s)",
            ([student_id] + ([teacher_id] if teacher_id is not None else []),),
        )
        await connection.execute(
            "delete from auth.users where id = any(%s)",
            ([student_id] + ([teacher_id] if teacher_id is not None else []),),
        )
        await connection.commit()
    finally:
        await connection.close()


async def test_two_connections_accept_one_transition_and_cool_down_the_other() -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 1, tzinfo=UTC))
    qr_secret = "q" * 64
    student_id, kiosk_id = uuid4(), uuid4()
    student = _student(student_id)
    await _seed_attendance_principals(
        database_url, student_id=student_id, kiosk_id=kiosk_id, clock=clock
    )
    barrier = asyncio.Barrier(2)

    async def scan_once(request_id: UUID):
        async with application_transaction(database_url=database_url) as connection:
            kiosk_service = _kiosk_service(connection, clock, qr_secret)
            token = kiosk_service.issue_qr_challenge(kiosk_id).token
            service = AttendanceService(
                AttendanceRepository(connection),
                kiosk_service,
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            )
            await barrier.wait()
            return await service.scan(student, token, request_id)

    try:
        results = await asyncio.wait_for(
            asyncio.gather(scan_once(uuid4()), scan_once(uuid4())), timeout=10
        )
        accepted = [item for item in results if item.cooldown_remaining is None]
        cooldowns = [item for item in results if item.cooldown_remaining is not None]

        assert len(accepted) == 1
        assert accepted[0].direction == Direction.IN
        assert len(cooldowns) == 1
        assert cooldowns[0].scan_id == accepted[0].scan_id
        assert cooldowns[0].cooldown_remaining == 10

        async with application_transaction(database_url=database_url) as connection:
            stored = await connection.execute(
                "select direction::text, count(*) from app.attendance_scans where student_id = %s group by direction",
                (student_id,),
            )
            assert await stored.fetchall() == [("IN", 1)]
    finally:
        await _cleanup_attendance_principals(
            database_url, student_id=student_id, kiosk_id=kiosk_id
        )


async def test_same_request_id_race_returns_one_scan_and_one_duplicate() -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 2, tzinfo=UTC))
    qr_secret = "r" * 64
    student_id, kiosk_id, request_id = uuid4(), uuid4(), uuid4()
    student = _student(student_id)
    await _seed_attendance_principals(
        database_url, student_id=student_id, kiosk_id=kiosk_id, clock=clock
    )
    barrier = asyncio.Barrier(2)

    async def retry_once():
        async with application_transaction(database_url=database_url) as connection:
            kiosk_service = _kiosk_service(connection, clock, qr_secret)
            token = kiosk_service.issue_qr_challenge(kiosk_id).token
            service = AttendanceService(
                AttendanceRepository(connection),
                kiosk_service,
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            )
            await barrier.wait()
            return await service.scan(student, token, request_id)

    try:
        results = await asyncio.wait_for(
            asyncio.gather(retry_once(), retry_once()), timeout=10
        )
        assert results[0].scan_id == results[1].scan_id
        assert sorted(item.duplicate for item in results) == [False, True]
        assert all(item.cooldown_remaining is None for item in results)
    finally:
        await _cleanup_attendance_principals(
            database_url, student_id=student_id, kiosk_id=kiosk_id
        )


async def test_live_database_enforces_9999ms_and_exact_10s_boundary() -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 3, tzinfo=UTC))
    qr_secret = "s" * 64
    student_id, kiosk_id = uuid4(), uuid4()
    student = _student(student_id)
    await _seed_attendance_principals(
        database_url, student_id=student_id, kiosk_id=kiosk_id, clock=clock
    )
    try:
        async with application_transaction(database_url=database_url) as connection:
            kiosk_service = _kiosk_service(connection, clock, qr_secret)
            service = AttendanceService(
                AttendanceRepository(connection),
                kiosk_service,
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            )
            first = await service.scan(
                student, kiosk_service.issue_qr_challenge(kiosk_id).token, uuid4()
            )
            clock.advance(seconds=9, milliseconds=999)
            cooldown = await service.scan(
                student, kiosk_service.issue_qr_challenge(kiosk_id).token, uuid4()
            )
            clock.advance(milliseconds=1)
            second = await service.scan(
                student, kiosk_service.issue_qr_challenge(kiosk_id).token, uuid4()
            )

        assert first.direction == Direction.IN
        assert cooldown.cooldown_remaining == pytest.approx(0.001)
        assert second.direction == Direction.OUT
    finally:
        await _cleanup_attendance_principals(
            database_url, student_id=student_id, kiosk_id=kiosk_id
        )


async def test_live_void_and_manual_corrections_are_append_only_and_audited() -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 4, tzinfo=UTC))
    qr_secret = "t" * 64
    student_id, kiosk_id, teacher_id = uuid4(), uuid4(), uuid4()
    student = _student(student_id)
    teacher = AuthenticatedUser(
        user_id=teacher_id,
        email=f"teacher-{teacher_id.hex}@example.com",
        provider="google",
        email_verified=True,
    )
    await _seed_attendance_principals(
        database_url,
        student_id=student_id,
        kiosk_id=kiosk_id,
        teacher_id=teacher_id,
        clock=clock,
    )
    try:
        async with application_transaction(database_url=database_url) as connection:
            kiosk_service = _kiosk_service(connection, clock, qr_secret)
            service = AttendanceService(
                AttendanceRepository(connection),
                kiosk_service,
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            )
            original = await service.scan(
                student, kiosk_service.issue_qr_challenge(kiosk_id).token, uuid4()
            )
            voided = await service.correct(
                teacher,
                AttendanceCorrectionInput(
                    mode=CorrectionMode.VOID,
                    scan_id=original.scan_id,
                    reason="중복 기록",
                ),
            )
            manual = await service.correct(
                teacher,
                AttendanceCorrectionInput(
                    mode=CorrectionMode.MANUAL,
                    student_id=student_id,
                    direction=Direction.OUT,
                    scanned_at=clock.now() + timedelta(minutes=1),
                    reason="퇴실 기록 보완",
                ),
            )
            rows = await connection.execute(
                """
                select id, direction::text, source::text, kiosk_session_id,
                       qr_issued_at, recorded_by, voided_by, void_reason
                from app.attendance_scans
                where student_id = %s
                order by scanned_at, id
                """,
                (student_id,),
            )
            audits = await connection.execute(
                """
                select action, target_id, details
                from app.audit_logs
                where actor_id = %s and action = 'attendance.corrected'
                order by created_at, id
                """,
                (teacher_id,),
            )
            stored_rows = await rows.fetchall()
            stored_audits = await audits.fetchall()

        assert voided.id == original.scan_id
        assert manual.id != original.scan_id
        assert stored_rows[0][1:3] == ("IN", "QR")
        assert stored_rows[0][3] == kiosk_id
        assert stored_rows[0][4] is not None
        assert stored_rows[0][5] is None
        assert stored_rows[0][6:] == (teacher_id, "중복 기록")
        assert stored_rows[1][1:3] == ("OUT", "MANUAL")
        assert stored_rows[1][3:5] == (None, None)
        assert stored_rows[1][5] == teacher_id
        audit_targets = {row[2]["mode"]: row[1] for row in stored_audits}
        assert audit_targets == {
            "VOID": str(original.scan_id),
            "MANUAL": str(manual.id),
        }
    finally:
        await _cleanup_attendance_principals(
            database_url,
            student_id=student_id,
            kiosk_id=kiosk_id,
            teacher_id=teacher_id,
        )


async def test_live_scan_rate_limit_is_durable_and_blocks_request_31() -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 5, tzinfo=UTC))
    qr_secret = "u" * 64
    student_id, kiosk_id = uuid4(), uuid4()
    student = _student(student_id)
    await _seed_attendance_principals(
        database_url, student_id=student_id, kiosk_id=kiosk_id, clock=clock
    )
    try:
        async with application_transaction(database_url=database_url) as connection:
            kiosk_service = _kiosk_service(connection, clock, qr_secret)
            service = AttendanceService(
                AttendanceRepository(connection),
                kiosk_service,
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            )
            token = kiosk_service.issue_qr_challenge(kiosk_id).token
            for _ in range(30):
                await service.scan(student, token, uuid4())
            with pytest.raises(ScanRateLimited):
                await service.scan(student, token, uuid4())

        async with application_transaction(database_url=database_url) as connection:
            cursor = await connection.execute(
                """
                select attempt_count, blocked_until > %s
                from app.rate_limit_buckets
                where bucket_key_hash = %s and action = 'attendance.scan'
                """,
                (clock.now(), _scan_rate_limit_key(student_id)),
            )
            assert await cursor.fetchone() == (31, True)
    finally:
        await _cleanup_attendance_principals(
            database_url, student_id=student_id, kiosk_id=kiosk_id
        )


async def test_live_attendance_scan_rechecks_expired_and_revoked_qr_session() -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 6, tzinfo=UTC))
    qr_secret = "v" * 64
    student_id, kiosk_id = uuid4(), uuid4()
    student = _student(student_id)
    await _seed_attendance_principals(
        database_url, student_id=student_id, kiosk_id=kiosk_id, clock=clock
    )
    try:
        async with application_transaction(database_url=database_url) as connection:
            kiosk_service = _kiosk_service(connection, clock, qr_secret)
            service = AttendanceService(
                AttendanceRepository(connection),
                kiosk_service,
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            )
            expired_token = kiosk_service.issue_qr_challenge(kiosk_id).token
            clock.advance(seconds=20)
            with pytest.raises(QrChallengeExpired):
                await service.scan(student, expired_token, uuid4())

            active_token = kiosk_service.issue_qr_challenge(kiosk_id).token
            await connection.execute(
                "update app.kiosk_sessions set revoked_at = %s where id = %s",
                (clock.now(), kiosk_id),
            )
            with pytest.raises(KioskSessionRevoked):
                await service.scan(student, active_token, uuid4())

            cursor = await connection.execute(
                "select count(*) from app.attendance_scans where student_id = %s",
                (student_id,),
            )
            assert await cursor.fetchone() == (0,)
    finally:
        await _cleanup_attendance_principals(
            database_url, student_id=student_id, kiosk_id=kiosk_id
        )


async def test_live_audit_failure_rolls_back_void_metadata() -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 7, tzinfo=UTC))
    qr_secret = "w" * 64
    student_id, kiosk_id, teacher_id = uuid4(), uuid4(), uuid4()
    student = _student(student_id)
    teacher = AuthenticatedUser(
        user_id=teacher_id,
        email=f"teacher-{teacher_id.hex}@example.com",
        provider="google",
        email_verified=True,
    )
    await _seed_attendance_principals(
        database_url,
        student_id=student_id,
        kiosk_id=kiosk_id,
        teacher_id=teacher_id,
        clock=clock,
    )
    try:
        async with application_transaction(database_url=database_url) as connection:
            kiosk_service = _kiosk_service(connection, clock, qr_secret)
            service = AttendanceService(
                AttendanceRepository(connection),
                kiosk_service,
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            )
            original = await service.scan(
                student, kiosk_service.issue_qr_challenge(kiosk_id).token, uuid4()
            )

        class FailingAuditRepository(AttendanceRepository):
            async def append_correction_audit(self, **_values: object) -> None:
                raise RuntimeError("simulated audit failure")

        with pytest.raises(RuntimeError, match="simulated audit failure"):
            async with application_transaction(database_url=database_url) as connection:
                service = AttendanceService(
                    FailingAuditRepository(connection),
                    _kiosk_service(connection, clock, qr_secret),
                    clock=clock,
                    rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
                )
                await service.correct(
                    teacher,
                    AttendanceCorrectionInput(
                        mode=CorrectionMode.VOID,
                        scan_id=original.scan_id,
                        reason="중복 기록",
                    ),
                )

        async with application_transaction(database_url=database_url) as connection:
            scan = await connection.execute(
                """
                select voided_at, voided_by, void_reason
                from app.attendance_scans where id = %s
                """,
                (original.scan_id,),
            )
            audit = await connection.execute(
                """
                select count(*) from app.audit_logs
                where target_id = %s and action = 'attendance.corrected'
                """,
                (str(original.scan_id),),
            )
            assert await scan.fetchone() == (None, None, None)
            assert await audit.fetchone() == (0,)
    finally:
        await _cleanup_attendance_principals(
            database_url,
            student_id=student_id,
            kiosk_id=kiosk_id,
            teacher_id=teacher_id,
        )
