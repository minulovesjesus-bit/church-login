import asyncio
import hashlib
import hmac
import os
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
import psycopg
import pytest

from backend.attendance.models import Direction
from backend.attendance.repository import AttendanceRepository
from backend.attendance.router import get_attendance_service
from backend.attendance.schemas import AttendanceCorrectionInput, CorrectionMode
from backend.attendance.service import AttendanceService, ScanRateLimited
from backend.core.auth import get_current_user
from backend.core.clock import FrozenClock
from backend.core.config import settings
from backend.core.db import application_transaction
from backend.identity.models import AuthenticatedUser
from backend.kiosk.repository import KioskRepository
from backend.kiosk.security import QrChallengeCodec
from backend.kiosk.service import (
    KioskSessionRevoked,
    KioskSessionService,
    QrChallengeExpired,
)
from backend.main import app

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

        async with application_transaction(database_url=database_url) as connection:
            bucket = await connection.execute(
                """
                select attempt_count
                from app.rate_limit_buckets
                where bucket_key_hash = %s and action = 'attendance.scan'
                """,
                (_scan_rate_limit_key(student_id),),
            )
            assert await bucket.fetchone() == (1,)
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
            limiter = await connection.execute(
                """
                select attempt_count
                from app.rate_limit_buckets
                where bucket_key_hash = %s and action = 'attendance.scan'
                """,
                (_scan_rate_limit_key(student_id),),
            )
            assert await limiter.fetchone() == (2,)
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


@pytest.mark.parametrize("invalidated_by", ["expiry", "revocation"])
async def test_live_api_retry_returns_original_after_qr_invalidation(
    client: httpx.AsyncClient,
    invalidated_by: str,
) -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 8, tzinfo=UTC))
    qr_secret = "x" * 64
    student_id, kiosk_id, request_id = uuid4(), uuid4(), uuid4()
    student = _student(student_id)
    await _seed_attendance_principals(
        database_url, student_id=student_id, kiosk_id=kiosk_id, clock=clock
    )

    async def current_student() -> AuthenticatedUser:
        return student

    async def real_attendance_service():
        async with application_transaction(database_url=database_url) as connection:
            kiosk_service = _kiosk_service(connection, clock, qr_secret)
            yield AttendanceService(
                AttendanceRepository(connection),
                kiosk_service,
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            )

    app.dependency_overrides[get_current_user] = current_student
    app.dependency_overrides[get_attendance_service] = real_attendance_service
    token = QrChallengeCodec(qr_secret, clock=clock).issue(kiosk_id)
    try:
        first = await client.post(
            "/api/attendance/scan",
            json={"qr_token": token, "request_id": str(request_id)},
        )
        if invalidated_by == "expiry":
            clock.advance(seconds=20)
        else:
            async with application_transaction(database_url=database_url) as connection:
                await connection.execute(
                    "update app.kiosk_sessions set revoked_at = %s where id = %s",
                    (clock.now(), kiosk_id),
                )

        retry = await client.post(
            "/api/attendance/scan",
            json={"qr_token": token, "request_id": str(request_id)},
        )

        assert first.status_code == 200
        assert first.json()["duplicate"] is False
        assert retry.status_code == 200
        assert retry.json()["scan_id"] == first.json()["scan_id"]
        assert retry.json()["direction"] == "IN"
        assert retry.json()["duplicate"] is True

        async with application_transaction(database_url=database_url) as connection:
            bucket = await connection.execute(
                """
                select attempt_count
                from app.rate_limit_buckets
                where bucket_key_hash = %s and action = 'attendance.scan'
                """,
                (_scan_rate_limit_key(student_id),),
            )
            assert await bucket.fetchone() == (1,)
    finally:
        app.dependency_overrides.clear()
        await _cleanup_attendance_principals(
            database_url, student_id=student_id, kiosk_id=kiosk_id
        )


async def test_live_api_invalid_qr_attempts_commit_and_reach_durable_limit(
    client: httpx.AsyncClient,
) -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 9, tzinfo=UTC))
    qr_secret = "y" * 64
    student_id, kiosk_id = uuid4(), uuid4()
    student = _student(student_id)
    await _seed_attendance_principals(
        database_url, student_id=student_id, kiosk_id=kiosk_id, clock=clock
    )

    async def current_student() -> AuthenticatedUser:
        return student

    async def real_attendance_service():
        async with application_transaction(database_url=database_url) as connection:
            yield AttendanceService(
                AttendanceRepository(connection),
                _kiosk_service(connection, clock, qr_secret),
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            )

    app.dependency_overrides[get_current_user] = current_student
    app.dependency_overrides[get_attendance_service] = real_attendance_service
    try:
        invalid_responses = [
            await client.post(
                "/api/attendance/scan",
                json={"qr_token": "not-a-jwt", "request_id": str(uuid4())},
            )
            for _ in range(30)
        ]
        limited = await client.post(
            "/api/attendance/scan",
            json={"qr_token": "not-a-jwt", "request_id": str(uuid4())},
        )

        assert all(response.status_code == 400 for response in invalid_responses)
        assert all(
            response.json()["error"]["code"] == "QR_INVALID"
            for response in invalid_responses
        )
        assert all(
            response.json()["error"]["request_id"] for response in invalid_responses
        )
        assert limited.status_code == 429
        assert limited.json()["error"]["code"] == "RATE_LIMITED"
        assert limited.headers["Retry-After"] == "60"

        async with application_transaction(database_url=database_url) as connection:
            bucket = await connection.execute(
                """
                select attempt_count, blocked_until > %s
                from app.rate_limit_buckets
                where bucket_key_hash = %s and action = 'attendance.scan'
                """,
                (clock.now(), _scan_rate_limit_key(student_id)),
            )
            assert await bucket.fetchone() == (31, True)
    finally:
        app.dependency_overrides.clear()
        await _cleanup_attendance_principals(
            database_url, student_id=student_id, kiosk_id=kiosk_id
        )


@pytest.mark.parametrize(
    ("invalidated_by", "expected_code"),
    [("expiry", "QR_EXPIRED"), ("revocation", "KIOSK_SESSION_REVOKED")],
)
async def test_live_api_expired_and_revoked_attempts_commit_limiter(
    client: httpx.AsyncClient,
    invalidated_by: str,
    expected_code: str,
) -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 9, 30, tzinfo=UTC))
    qr_secret = "m" * 64
    student_id, kiosk_id = uuid4(), uuid4()
    student = _student(student_id)
    await _seed_attendance_principals(
        database_url, student_id=student_id, kiosk_id=kiosk_id, clock=clock
    )

    async def current_student() -> AuthenticatedUser:
        return student

    async def real_attendance_service():
        async with application_transaction(database_url=database_url) as connection:
            yield AttendanceService(
                AttendanceRepository(connection),
                _kiosk_service(connection, clock, qr_secret),
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            )

    app.dependency_overrides[get_current_user] = current_student
    app.dependency_overrides[get_attendance_service] = real_attendance_service
    token = QrChallengeCodec(qr_secret, clock=clock).issue(kiosk_id)
    try:
        if invalidated_by == "expiry":
            clock.advance(seconds=20)
        else:
            async with application_transaction(database_url=database_url) as connection:
                await connection.execute(
                    "update app.kiosk_sessions set revoked_at = %s where id = %s",
                    (clock.now(), kiosk_id),
                )

        response = await client.post(
            "/api/attendance/scan",
            json={"qr_token": token, "request_id": str(uuid4())},
        )

        assert response.status_code == (400 if invalidated_by == "expiry" else 401)
        assert response.json()["error"]["code"] == expected_code
        assert response.json()["error"]["request_id"]
        async with application_transaction(database_url=database_url) as connection:
            bucket = await connection.execute(
                """
                select attempt_count
                from app.rate_limit_buckets
                where bucket_key_hash = %s and action = 'attendance.scan'
                """,
                (_scan_rate_limit_key(student_id),),
            )
            assert await bucket.fetchone() == (1,)
    finally:
        app.dependency_overrides.clear()
        await _cleanup_attendance_principals(
            database_url, student_id=student_id, kiosk_id=kiosk_id
        )


async def test_live_unique_conflict_uses_on_conflict_fallback() -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 10, tzinfo=UTC))
    qr_secret = "z" * 64
    student_id, kiosk_id, request_id = uuid4(), uuid4(), uuid4()
    student = _student(student_id)
    await _seed_attendance_principals(
        database_url, student_id=student_id, kiosk_id=kiosk_id, clock=clock
    )

    class InjectingConflictRepository(AttendanceRepository):
        injected = False

        async def insert_qr_scan(self, **values: Any):
            conflict_connection = await psycopg.AsyncConnection.connect(database_url)
            try:
                await conflict_connection.execute("set local role app_backend")
                await conflict_connection.execute(
                    """
                    insert into app.attendance_scans (
                      student_id, attendance_date, direction, scanned_at,
                      kiosk_session_id, request_id, qr_issued_at, source
                    ) values (%s, %s, %s, %s, %s, %s, %s, 'QR')
                    """,
                    (
                        values["student_id"],
                        values["attendance_date"],
                        values["direction"].value,
                        values["scanned_at"],
                        values["kiosk_session_id"],
                        values["request_id"],
                        values["qr_issued_at"],
                    ),
                )
                await conflict_connection.commit()
                self.injected = True
            finally:
                await conflict_connection.close()
            return await super().insert_qr_scan(**values)

    try:
        async with application_transaction(database_url=database_url) as connection:
            repository = InjectingConflictRepository(connection)
            kiosk_service = _kiosk_service(connection, clock, qr_secret)
            result = await AttendanceService(
                repository,
                kiosk_service,
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            ).scan(
                student,
                kiosk_service.issue_qr_challenge(kiosk_id).token,
                request_id,
            )

            rows = await connection.execute(
                """
                select id, direction::text, request_id
                from app.attendance_scans where student_id = %s
                """,
                (student_id,),
            )
            stored = await rows.fetchall()

        assert repository.injected is True
        assert result.duplicate is True
        assert result.direction == Direction.IN
        assert len(stored) == 1
        assert stored[0][0] == result.scan_id
        assert stored[0][2] == request_id
    finally:
        await _cleanup_attendance_principals(
            database_url, student_id=student_id, kiosk_id=kiosk_id
        )


async def test_live_request_id_isolation_never_returns_another_students_scan() -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 10, 30, tzinfo=UTC))
    qr_secret = "j" * 64
    first_student_id, second_student_id, kiosk_id, request_id = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )
    first_student = _student(first_student_id)
    second_student = _student(second_student_id)
    await _seed_attendance_principals(
        database_url,
        student_id=first_student_id,
        kiosk_id=kiosk_id,
        clock=clock,
    )
    seed_connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        await seed_connection.execute(
            "insert into auth.users (id) values (%s)", (second_student_id,)
        )
        await seed_connection.execute(
            """
            insert into app.user_profiles (user_id, email, name)
            values (%s, %s, '다른 학생')
            """,
            (second_student_id, second_student.email),
        )
        await seed_connection.execute(
            """
            insert into app.student_profiles (user_id, birth_date, guardian_phone)
            values (%s, '2012-04-03', '01099998888')
            """,
            (second_student_id,),
        )
        await seed_connection.commit()
    finally:
        await seed_connection.close()

    try:
        token = QrChallengeCodec(qr_secret, clock=clock).issue(kiosk_id)
        async with application_transaction(database_url=database_url) as connection:
            first = await AttendanceService(
                AttendanceRepository(connection),
                _kiosk_service(connection, clock, qr_secret),
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            ).scan(first_student, token, request_id)
        clock.advance(seconds=20)
        async with application_transaction(database_url=database_url) as connection:
            with pytest.raises(QrChallengeExpired):
                await AttendanceService(
                    AttendanceRepository(connection),
                    _kiosk_service(connection, clock, qr_secret),
                    clock=clock,
                    rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
                ).scan(second_student, token, request_id)

        async with application_transaction(database_url=database_url) as connection:
            scans = await connection.execute(
                """
                select student_id, id
                from app.attendance_scans where request_id = %s
                """,
                (request_id,),
            )
            second_bucket = await connection.execute(
                """
                select attempt_count
                from app.rate_limit_buckets
                where bucket_key_hash = %s and action = 'attendance.scan'
                """,
                (_scan_rate_limit_key(second_student_id),),
            )
            assert await scans.fetchall() == [(first_student_id, first.scan_id)]
            assert await second_bucket.fetchone() == (1,)
    finally:
        cleanup_connection = await psycopg.AsyncConnection.connect(database_url)
        try:
            await cleanup_connection.execute(
                """
                delete from app.rate_limit_buckets
                where bucket_key_hash = %s and action = 'attendance.scan'
                """,
                (_scan_rate_limit_key(second_student_id),),
            )
            await cleanup_connection.execute(
                "delete from app.student_profiles where user_id = %s",
                (second_student_id,),
            )
            await cleanup_connection.execute(
                "delete from app.user_profiles where user_id = %s",
                (second_student_id,),
            )
            await cleanup_connection.execute(
                "delete from auth.users where id = %s", (second_student_id,)
            )
            await cleanup_connection.commit()
        finally:
            await cleanup_connection.close()
        await _cleanup_attendance_principals(
            database_url, student_id=first_student_id, kiosk_id=kiosk_id
        )


async def test_concurrent_revoke_waits_for_inflight_scan_then_takes_effect() -> None:
    database_url = _loopback_database_url()
    clock = FrozenClock(datetime(2026, 8, 21, 11, tzinfo=UTC))
    qr_secret = "k" * 64
    student_id, kiosk_id = uuid4(), uuid4()
    student = _student(student_id)
    await _seed_attendance_principals(
        database_url, student_id=student_id, kiosk_id=kiosk_id, clock=clock
    )
    kiosk_locked = asyncio.Event()
    allow_scan_to_finish = asyncio.Event()
    revoke_started = asyncio.Event()

    class PausingKioskLockRepository(AttendanceRepository):
        async def lock_active_kiosk_session(
            self, kiosk_session_id: UUID, now: datetime
        ) -> bool:
            active = await super().lock_active_kiosk_session(kiosk_session_id, now)
            kiosk_locked.set()
            await allow_scan_to_finish.wait()
            return active

    async def scan_once():
        async with application_transaction(database_url=database_url) as connection:
            kiosk_service = _kiosk_service(connection, clock, qr_secret)
            return await AttendanceService(
                PausingKioskLockRepository(connection),
                kiosk_service,
                clock=clock,
                rate_limit_secret=LIVE_RATE_LIMIT_SECRET,
            ).scan(
                student,
                kiosk_service.issue_qr_challenge(kiosk_id).token,
                uuid4(),
            )

    async def revoke_once() -> bool:
        await kiosk_locked.wait()
        async with application_transaction(database_url=database_url) as connection:
            revoke_started.set()
            return await KioskRepository(connection).revoke_session(
                kiosk_id, clock.now()
            )

    scan_task = asyncio.create_task(scan_once())
    revoke_task = asyncio.create_task(revoke_once())
    try:
        await asyncio.wait_for(revoke_started.wait(), timeout=5)
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(asyncio.shield(revoke_task), timeout=0.1)

        allow_scan_to_finish.set()
        result, revoked = await asyncio.wait_for(
            asyncio.gather(scan_task, revoke_task), timeout=10
        )

        assert result.direction == Direction.IN
        assert result.duplicate is False
        assert revoked is True
        async with application_transaction(database_url=database_url) as connection:
            session = await connection.execute(
                "select revoked_at is not null from app.kiosk_sessions where id = %s",
                (kiosk_id,),
            )
            scans = await connection.execute(
                "select count(*) from app.attendance_scans where student_id = %s",
                (student_id,),
            )
            assert await session.fetchone() == (True,)
            assert await scans.fetchone() == (1,)
    finally:
        allow_scan_to_finish.set()
        await asyncio.gather(scan_task, revoke_task, return_exceptions=True)
        await _cleanup_attendance_principals(
            database_url, student_id=student_id, kiosk_id=kiosk_id
        )
