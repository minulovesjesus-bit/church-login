from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest

from backend.attendance.models import AttendanceScan, Direction, Source
from backend.attendance.router import get_attendance_service
from backend.attendance.schemas import (
    AttendanceCorrectionInput,
    CorrectionMode,
    ScanResult,
)
from backend.attendance.service import AttendanceService, ScanRateLimited
from backend.core.auth import get_current_user
from backend.core.clock import FrozenClock
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.router import require_teacher
from backend.kiosk.schemas import QrChallenge
from backend.kiosk.service import (
    KioskSessionRevoked,
    QrChallengeExpired,
    QrChallengeInvalid,
)
from backend.main import app


class FakeQrService:
    def __init__(self, challenge: QrChallenge) -> None:
        self.challenge = challenge
        self.tokens: list[str] = []
        self.error: ApiError | None = None

    async def verify_qr_challenge(self, token: str) -> QrChallenge:
        self.tokens.append(token)
        if self.error is not None:
            raise self.error
        return self.challenge


class InMemoryAttendanceRepository:
    def __init__(self, student_id: UUID, *, staff_role: str | None = None) -> None:
        self.student_id = student_id
        self.student_ids = {student_id}
        self.staff_role_value = staff_role
        self.scans: list[AttendanceScan] = []
        self.audit_entries: list[tuple[UUID, str, UUID, dict[str, object]]] = []
        self.locked_keys: list[tuple[UUID, date]] = []
        self.locked_request_keys: list[tuple[UUID, UUID]] = []
        self.rate_limit_allowed = True
        self.rate_limit_keys: list[str] = []
        self.simulate_insert_conflict = False
        self.kiosk_session_active = True
        self.locked_kiosk_sessions: list[UUID] = []

    async def student_exists(self, student_id: UUID) -> bool:
        return student_id in self.student_ids

    async def scan_by_request(
        self, student_id: UUID, request_id: UUID
    ) -> AttendanceScan | None:
        return next(
            (
                scan
                for scan in self.scans
                if scan.student_id == student_id and scan.request_id == request_id
            ),
            None,
        )

    async def scan_by_id(self, scan_id: UUID) -> AttendanceScan | None:
        return next((scan for scan in self.scans if scan.id == scan_id), None)

    async def lock_student_date(self, student_id: UUID, attendance_date: date) -> None:
        self.locked_keys.append((student_id, attendance_date))

    async def lock_student_request(self, student_id: UUID, request_id: UUID) -> None:
        self.locked_request_keys.append((student_id, request_id))

    async def latest_non_voided_scan(
        self, student_id: UUID, attendance_date: date
    ) -> AttendanceScan | None:
        matches = [
            scan
            for scan in self.scans
            if scan.student_id == student_id
            and scan.attendance_date == attendance_date
            and scan.voided_at is None
        ]
        return max(matches, key=lambda scan: (scan.scanned_at, scan.id)) if matches else None

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
        duplicate = await self.scan_by_request(student_id, request_id)
        if duplicate is not None:
            return None
        scan = AttendanceScan(
            id=uuid4(),
            student_id=student_id,
            attendance_date=attendance_date,
            direction=direction,
            scanned_at=scanned_at,
            kiosk_session_id=kiosk_session_id,
            request_id=request_id,
            qr_issued_at=qr_issued_at,
            source=Source.QR,
            recorded_by=None,
            voided_at=None,
            voided_by=None,
            void_reason=None,
        )
        self.scans.append(scan)
        return None if self.simulate_insert_conflict else scan

    async def lock_active_kiosk_session(
        self, kiosk_session_id: UUID, now: datetime
    ) -> bool:
        self.locked_kiosk_sessions.append(kiosk_session_id)
        return self.kiosk_session_active

    async def consume_scan_rate_limit(
        self, key_hash: str, now: datetime
    ) -> bool:
        self.rate_limit_keys.append(key_hash)
        return self.rate_limit_allowed

    async def staff_role(self, user_id: UUID) -> str | None:
        return self.staff_role_value

    async def void_scan(
        self, scan_id: UUID, *, actor_id: UUID, reason: str, now: datetime
    ) -> AttendanceScan | None:
        for index, scan in enumerate(self.scans):
            if scan.id == scan_id and scan.voided_at is None:
                changed = AttendanceScan(
                    **{
                        **scan.__dict__,
                        "voided_at": now,
                        "voided_by": actor_id,
                        "void_reason": reason,
                    }
                )
                self.scans[index] = changed
                return changed
        return None

    async def insert_manual_scan(
        self,
        *,
        student_id: UUID,
        direction: Direction,
        scanned_at: datetime,
        actor_id: UUID,
    ) -> AttendanceScan:
        scan = AttendanceScan(
            id=uuid4(),
            student_id=student_id,
            attendance_date=scanned_at.astimezone(
                AttendanceService.BUSINESS_TIMEZONE
            ).date(),
            direction=direction,
            scanned_at=scanned_at,
            kiosk_session_id=None,
            request_id=uuid4(),
            qr_issued_at=None,
            source=Source.MANUAL,
            recorded_by=actor_id,
            voided_at=None,
            voided_by=None,
            void_reason=None,
        )
        self.scans.append(scan)
        return scan

    async def append_correction_audit(
        self,
        *,
        actor_id: UUID,
        mode: CorrectionMode,
        scan_id: UUID,
        details: dict[str, object],
    ) -> None:
        self.audit_entries.append((actor_id, mode.value, scan_id, details))


@pytest.fixture
def student() -> AuthenticatedUser:
    return AuthenticatedUser(
        user_id=uuid4(),
        email="student@example.com",
        provider="password",
        email_verified=True,
    )


@pytest.fixture
def clock() -> FrozenClock:
    return FrozenClock(datetime(2026, 8, 21, 1, tzinfo=UTC))


@pytest.fixture
def attendance_service(
    student: AuthenticatedUser, clock: FrozenClock
) -> tuple[AttendanceService, InMemoryAttendanceRepository, FakeQrService]:
    challenge = QrChallenge(
        kiosk_session_id=uuid4(),
        issued_at=clock.now(),
        expires_at=clock.now() + timedelta(seconds=20),
        nonce=uuid4(),
    )
    repository = InMemoryAttendanceRepository(student.user_id)
    qr_service = FakeQrService(challenge)
    return (
        AttendanceService(
            repository,
            qr_service,
            clock=clock,
            rate_limit_secret="unit-rate-limit-secret",
        ),  # type: ignore[arg-type]
        repository,
        qr_service,
    )


async def test_four_accepted_scans_alternate_in_out_after_exact_cooldown(
    attendance_service: tuple[
        AttendanceService, InMemoryAttendanceRepository, FakeQrService
    ],
    student: AuthenticatedUser,
    clock: FrozenClock,
) -> None:
    service, repository, _ = attendance_service

    first = await service.scan(student, "qr-one", uuid4())
    clock.advance(seconds=9, milliseconds=999)
    cooldown = await service.scan(student, "qr-two", uuid4())
    clock.advance(milliseconds=1)
    second = await service.scan(student, "qr-three", uuid4())
    clock.advance(seconds=10)
    third = await service.scan(student, "qr-four", uuid4())
    clock.advance(seconds=10)
    fourth = await service.scan(student, "qr-five", uuid4())

    assert [first.direction, second.direction, third.direction, fourth.direction] == [
        Direction.IN,
        Direction.OUT,
        Direction.IN,
        Direction.OUT,
    ]
    assert cooldown.scan_id == first.scan_id
    assert cooldown.direction == Direction.IN
    assert cooldown.duplicate is False
    assert cooldown.cooldown_remaining == pytest.approx(0.001)
    assert len(repository.scans) == 4


@pytest.mark.parametrize("later_qr_error", [QrChallengeExpired(), KioskSessionRevoked()])
async def test_retry_returns_original_even_after_qr_or_session_becomes_invalid(
    attendance_service: tuple[
        AttendanceService, InMemoryAttendanceRepository, FakeQrService
    ],
    student: AuthenticatedUser,
    later_qr_error: ApiError,
) -> None:
    service, repository, qr_service = attendance_service
    request_id = uuid4()

    first = await service.scan(student, "qr-token", request_id)
    repository.rate_limit_allowed = False
    repository.kiosk_session_active = False
    qr_service.error = later_qr_error
    retry = await service.scan(student, "expired-or-revoked", request_id)

    assert retry.scan_id == first.scan_id
    assert retry.direction == first.direction
    assert retry.scanned_at == first.scanned_at
    assert retry.duplicate is True
    assert retry.cooldown_remaining is None
    assert len(repository.scans) == 1
    assert len(repository.rate_limit_keys) == 1
    assert qr_service.tokens == ["qr-token"]


async def test_same_request_id_cannot_read_another_students_scan(
    attendance_service: tuple[
        AttendanceService, InMemoryAttendanceRepository, FakeQrService
    ],
    student: AuthenticatedUser,
) -> None:
    service, repository, qr_service = attendance_service
    request_id = uuid4()
    first = await service.scan(student, "valid", request_id)
    other_student = AuthenticatedUser(
        user_id=uuid4(),
        email="other-student@example.com",
        provider="password",
        email_verified=True,
    )
    repository.student_ids.add(other_student.user_id)
    qr_service.error = QrChallengeExpired()

    with pytest.raises(QrChallengeExpired):
        await service.scan(other_student, "expired", request_id)

    assert first.duplicate is False
    assert len(repository.scans) == 1
    assert repository.scans[0].student_id == student.user_id
    assert qr_service.tokens == ["valid", "expired"]
    assert len(repository.rate_limit_keys) == 2


async def test_unique_conflict_fallback_returns_committed_original_result(
    attendance_service: tuple[
        AttendanceService, InMemoryAttendanceRepository, FakeQrService
    ],
    student: AuthenticatedUser,
) -> None:
    service, repository, _ = attendance_service
    repository.simulate_insert_conflict = True

    result = await service.scan(student, "qr-token", uuid4())

    assert result.duplicate is True
    assert result.direction == Direction.IN
    assert len(repository.scans) == 1


async def test_scan_rate_limit_uses_only_server_keyed_student_digest(
    attendance_service: tuple[
        AttendanceService, InMemoryAttendanceRepository, FakeQrService
    ],
    student: AuthenticatedUser,
) -> None:
    service, repository, _ = attendance_service
    repository.rate_limit_allowed = False

    with pytest.raises(ScanRateLimited) as limited:
        await service.scan(student, "qr-token", uuid4())

    assert limited.value.code == "RATE_LIMITED"
    assert limited.value.status_code == 429
    assert len(repository.rate_limit_keys) == 1
    assert repository.rate_limit_keys[0].startswith("hmac-sha256:")
    assert str(student.user_id) not in repository.rate_limit_keys[0]
    assert repository.scans == []


async def test_scan_uses_only_authenticated_student_and_verified_qr_values(
    attendance_service: tuple[
        AttendanceService, InMemoryAttendanceRepository, FakeQrService
    ],
    student: AuthenticatedUser,
    clock: FrozenClock,
) -> None:
    service, repository, qr_service = attendance_service

    result = await service.scan(student, "opaque-signed-qr", uuid4())
    stored = repository.scans[0]

    assert result.direction == Direction.IN
    assert stored.student_id == student.user_id
    assert stored.scanned_at == clock.now()
    assert stored.attendance_date == date(2026, 8, 21)
    assert stored.kiosk_session_id == qr_service.challenge.kiosk_session_id
    assert stored.qr_issued_at == qr_service.challenge.issued_at
    assert qr_service.tokens == ["opaque-signed-qr"]
    assert repository.locked_kiosk_sessions == [
        qr_service.challenge.kiosk_session_id
    ]


async def test_scan_requires_existing_student_profile_and_preserves_qr_errors(
    attendance_service: tuple[
        AttendanceService, InMemoryAttendanceRepository, FakeQrService
    ],
    student: AuthenticatedUser,
) -> None:
    service, repository, qr_service = attendance_service
    other_user = AuthenticatedUser(
        user_id=uuid4(),
        email="other@example.com",
        provider="password",
        email_verified=True,
    )

    with pytest.raises(ApiError) as missing_profile:
        await service.scan(other_user, "qr-token", uuid4())
    assert missing_profile.value.code == "PROFILE_REQUIRED"
    assert qr_service.tokens == []
    assert repository.rate_limit_keys == []

    qr_service.error = QrChallengeExpired()
    with pytest.raises(QrChallengeExpired):
        await service.scan(student, "expired", uuid4())
    qr_service.error = KioskSessionRevoked()
    with pytest.raises(KioskSessionRevoked):
        await service.scan(student, "revoked", uuid4())
    assert repository.scans == []
    assert len(repository.rate_limit_keys) == 2


async def test_invalid_qr_consumes_rate_limit_before_verification(
    attendance_service: tuple[
        AttendanceService, InMemoryAttendanceRepository, FakeQrService
    ],
    student: AuthenticatedUser,
) -> None:
    service, repository, qr_service = attendance_service
    qr_service.error = QrChallengeInvalid()

    request_id = uuid4()
    with pytest.raises(QrChallengeInvalid):
        await service.scan(student, "malformed", request_id)

    assert len(repository.rate_limit_keys) == 1
    assert repository.locked_request_keys == [(student.user_id, request_id)]
    assert repository.locked_keys == []
    assert repository.locked_kiosk_sessions == []
    assert repository.scans == []


async def test_scan_rechecks_and_locks_durable_kiosk_before_insert(
    attendance_service: tuple[
        AttendanceService, InMemoryAttendanceRepository, FakeQrService
    ],
    student: AuthenticatedUser,
) -> None:
    service, repository, qr_service = attendance_service
    repository.kiosk_session_active = False

    with pytest.raises(KioskSessionRevoked):
        await service.scan(student, "validly-signed-but-revoked", uuid4())

    assert repository.locked_kiosk_sessions == [
        qr_service.challenge.kiosk_session_id
    ]
    assert len(repository.rate_limit_keys) == 1
    assert len(repository.locked_request_keys) == 1
    assert repository.locked_keys == [(student.user_id, date(2026, 8, 21))]
    assert repository.scans == []


async def test_teacher_can_void_and_append_manual_scan_with_audit(
    student: AuthenticatedUser, clock: FrozenClock
) -> None:
    teacher = AuthenticatedUser(
        user_id=uuid4(),
        email="teacher@example.com",
        provider="google",
        email_verified=True,
    )
    repository = InMemoryAttendanceRepository(student.user_id, staff_role="teacher")
    challenge = QrChallenge(
        kiosk_session_id=uuid4(),
        issued_at=clock.now(),
        expires_at=clock.now() + timedelta(seconds=20),
        nonce=uuid4(),
    )
    service = AttendanceService(
        repository,
        FakeQrService(challenge),
        clock=clock,
        rate_limit_secret="unit-rate-limit-secret",
    )
    original = await service.scan(student, "qr", uuid4())

    voided = await service.correct(
        teacher,
        AttendanceCorrectionInput(
            mode=CorrectionMode.VOID,
            scan_id=original.scan_id,
            reason="중복 기록",
        ),
    )
    manual_time = datetime(2026, 8, 21, 6, 30, tzinfo=UTC)
    manual = await service.correct(
        teacher,
        AttendanceCorrectionInput(
            mode=CorrectionMode.MANUAL,
            student_id=student.user_id,
            direction=Direction.OUT,
            scanned_at=manual_time,
            reason="퇴실 기록 보완",
        ),
    )

    assert voided.id == original.scan_id
    assert voided.voided_by == teacher.user_id
    assert voided.void_reason == "중복 기록"
    assert manual.source == Source.MANUAL
    assert manual.recorded_by == teacher.user_id
    assert manual.kiosk_session_id is None
    assert manual.qr_issued_at is None
    assert [entry[1] for entry in repository.audit_entries] == ["VOID", "MANUAL"]
    assert repository.audit_entries[0][3] == {
        "mode": "VOID",
        "reason": "중복 기록",
    }
    assert repository.locked_keys == [
        (student.user_id, date(2026, 8, 21)),
        (student.user_id, date(2026, 8, 21)),
        (student.user_id, date(2026, 8, 21)),
    ]


async def test_correction_rechecks_staff_role_and_rejects_blank_reason(
    student: AuthenticatedUser, clock: FrozenClock
) -> None:
    actor = AuthenticatedUser(
        user_id=uuid4(),
        email="former@example.com",
        provider="google",
        email_verified=True,
    )
    repository = InMemoryAttendanceRepository(student.user_id, staff_role=None)
    challenge = QrChallenge(
        kiosk_session_id=uuid4(),
        issued_at=clock.now(),
        expires_at=clock.now() + timedelta(seconds=20),
        nonce=uuid4(),
    )
    service = AttendanceService(
        repository,
        FakeQrService(challenge),
        clock=clock,
        rate_limit_secret="unit-rate-limit-secret",
    )

    with pytest.raises(ApiError) as forbidden:
        await service.correct(
            actor,
            AttendanceCorrectionInput(
                mode=CorrectionMode.MANUAL,
                student_id=student.user_id,
                direction=Direction.IN,
                scanned_at=clock.now(),
                reason="정상 사유",
            ),
        )
    assert forbidden.value.code == "FORBIDDEN"

    with pytest.raises(ValueError):
        AttendanceCorrectionInput(
            mode=CorrectionMode.VOID,
            scan_id=uuid4(),
            reason="   ",
        )


class FakeAttendanceApiService:
    def __init__(self, now: datetime) -> None:
        self.now = now
        self.scan_calls: list[tuple[AuthenticatedUser, str, UUID]] = []
        self.correction_calls: list[
            tuple[AuthenticatedUser, AttendanceCorrectionInput]
        ] = []
        self.scan_error: ApiError | None = None

    async def scan(
        self, user: AuthenticatedUser, qr_token: str, request_id: UUID
    ) -> ScanResult:
        self.scan_calls.append((user, qr_token, request_id))
        if self.scan_error is not None:
            raise self.scan_error
        return ScanResult(
            scan_id=uuid4(),
            direction=Direction.IN,
            scanned_at=self.now,
            duplicate=False,
            cooldown_remaining=None,
        )

    async def correct(
        self, user: AuthenticatedUser, correction: AttendanceCorrectionInput
    ) -> AttendanceScan:
        self.correction_calls.append((user, correction))
        return AttendanceScan(
            id=correction.scan_id or uuid4(),
            student_id=correction.student_id or uuid4(),
            attendance_date=self.now.date(),
            direction=correction.direction or Direction.IN,
            scanned_at=correction.scanned_at or self.now,
            kiosk_session_id=None,
            request_id=uuid4(),
            qr_issued_at=None,
            source=Source.MANUAL,
            recorded_by=user.user_id,
            voided_at=None,
            voided_by=None,
            void_reason=None,
        )


async def test_scan_api_accepts_only_qr_token_and_request_id_from_body(
    client: httpx.AsyncClient, student: AuthenticatedUser, clock: FrozenClock
) -> None:
    service = FakeAttendanceApiService(clock.now())

    async def current_student() -> AuthenticatedUser:
        return student

    app.dependency_overrides[get_current_user] = current_student
    app.dependency_overrides[get_attendance_service] = lambda: service
    try:
        rejected = await client.post(
            "/api/attendance/scan",
            json={
                "qr_token": "signed-qr",
                "request_id": str(uuid4()),
                "student_id": str(uuid4()),
                "direction": "OUT",
                "scanned_at": "2020-01-01T00:00:00Z",
                "kiosk_session_id": str(uuid4()),
            },
        )
        request_id = uuid4()
        accepted = await client.post(
            "/api/attendance/scan",
            json={"qr_token": "signed-qr", "request_id": str(request_id)},
        )
    finally:
        app.dependency_overrides.clear()

    assert rejected.status_code == 422
    assert accepted.status_code == 200
    assert service.scan_calls == [(student, "signed-qr", request_id)]
    assert accepted.json()["direction"] == "IN"


async def test_scan_api_requires_authenticated_student(
    client: httpx.AsyncClient, clock: FrozenClock
) -> None:
    service = FakeAttendanceApiService(clock.now())
    app.dependency_overrides[get_attendance_service] = lambda: service
    try:
        response = await client.post(
            "/api/attendance/scan",
            json={"qr_token": "signed-qr", "request_id": str(uuid4())},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
    assert service.scan_calls == []


async def test_correction_api_uses_authenticated_teacher_as_actor(
    client: httpx.AsyncClient, clock: FrozenClock
) -> None:
    teacher = AuthenticatedUser(
        user_id=uuid4(),
        email="teacher@example.com",
        provider="google",
        email_verified=True,
    )
    service = FakeAttendanceApiService(clock.now())

    async def current_teacher() -> AuthenticatedUser:
        return teacher

    app.dependency_overrides[require_teacher] = current_teacher
    app.dependency_overrides[get_attendance_service] = lambda: service
    try:
        response = await client.post(
            "/api/teacher/attendance/corrections",
            json={
                "mode": "MANUAL",
                "student_id": str(uuid4()),
                "direction": "OUT",
                "scanned_at": clock.now().isoformat(),
                "reason": "퇴실 기록 보완",
                "actor_id": str(uuid4()),
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert service.correction_calls == []


async def test_valid_correction_api_uses_only_authenticated_teacher_actor(
    client: httpx.AsyncClient, clock: FrozenClock
) -> None:
    teacher = AuthenticatedUser(
        user_id=uuid4(),
        email="teacher@example.com",
        provider="google",
        email_verified=True,
    )
    service = FakeAttendanceApiService(clock.now())

    async def current_teacher() -> AuthenticatedUser:
        return teacher

    app.dependency_overrides[require_teacher] = current_teacher
    app.dependency_overrides[get_attendance_service] = lambda: service
    student_id = uuid4()
    try:
        response = await client.post(
            "/api/teacher/attendance/corrections",
            json={
                "mode": "MANUAL",
                "student_id": str(student_id),
                "direction": "OUT",
                "scanned_at": clock.now().isoformat(),
                "reason": "퇴실 기록 보완",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert len(service.correction_calls) == 1
    assert service.correction_calls[0][0] == teacher
    assert service.correction_calls[0][1].student_id == student_id
    assert "request_id" not in response.text


@pytest.mark.parametrize(
    ("error", "status_code", "code"),
    [
        (QrChallengeExpired(), 400, "QR_EXPIRED"),
        (KioskSessionRevoked(), 401, "KIOSK_SESSION_REVOKED"),
        (ScanRateLimited(), 429, "RATE_LIMITED"),
    ],
)
async def test_scan_api_preserves_stable_safe_domain_errors(
    client: httpx.AsyncClient,
    student: AuthenticatedUser,
    clock: FrozenClock,
    error: ApiError,
    status_code: int,
    code: str,
) -> None:
    service = FakeAttendanceApiService(clock.now())
    service.scan_error = error
    dependency_finished = False

    async def current_student() -> AuthenticatedUser:
        return student

    async def transactional_service():
        nonlocal dependency_finished
        yield service
        dependency_finished = True

    app.dependency_overrides[get_current_user] = current_student
    app.dependency_overrides[get_attendance_service] = transactional_service
    try:
        response = await client.post(
            "/api/attendance/scan",
            json={"qr_token": "signed-qr", "request_id": str(uuid4())},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == status_code
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["request_id"]
    assert "Traceback" not in response.text
    assert dependency_finished is True


async def test_scan_transaction_finishes_before_success_response(
    client: httpx.AsyncClient, student: AuthenticatedUser, clock: FrozenClock
) -> None:
    service = FakeAttendanceApiService(clock.now())

    async def current_student() -> AuthenticatedUser:
        return student

    async def failing_transaction_service():
        yield service
        raise ApiError("DATABASE_UNAVAILABLE", "잠시 후 다시 시도해 주세요.", 503)

    app.dependency_overrides[get_current_user] = current_student
    app.dependency_overrides[get_attendance_service] = failing_transaction_service
    try:
        response = await client.post(
            "/api/attendance/scan",
            json={"qr_token": "signed-qr", "request_id": str(uuid4())},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
