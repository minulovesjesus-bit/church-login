import hashlib
import hmac
from datetime import UTC, timedelta
from typing import Protocol
from uuid import UUID
from zoneinfo import ZoneInfo

from backend.attendance.models import AttendanceScan, Direction
from backend.attendance.repository import AttendanceRepository
from backend.attendance.schemas import (
    AttendanceCorrectionInput,
    CorrectionMode,
    ScanResult,
)
from backend.core.clock import Clock, SystemClock
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.kiosk.schemas import QrChallenge
from backend.kiosk.service import KioskSessionRevoked


class QrVerifier(Protocol):
    async def verify_qr_challenge(self, token: str) -> QrChallenge: ...


class ScanRateLimited(ApiError):
    def __init__(self) -> None:
        super().__init__(
            "RATE_LIMITED",
            "출결 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
            429,
        )


class AttendanceService:
    BUSINESS_TIMEZONE = ZoneInfo("Asia/Seoul")
    COOLDOWN = timedelta(seconds=10)

    def __init__(
        self,
        repository: AttendanceRepository,
        qr_service: QrVerifier,
        *,
        clock: Clock | None = None,
        rate_limit_secret: str,
    ) -> None:
        self._repository = repository
        self._qr_service = qr_service
        self._clock = clock or SystemClock()
        self._rate_limit_secret = rate_limit_secret

    async def scan(
        self, user: AuthenticatedUser, qr_token: str, request_id: UUID
    ) -> ScanResult:
        challenge = await self._qr_service.verify_qr_challenge(qr_token)
        if not await self._repository.student_exists(user.user_id):
            raise ApiError(
                "PROFILE_REQUIRED",
                "학생 정보를 먼저 등록해 주세요.",
                403,
            )

        duplicate = await self._repository.scan_by_request(user.user_id, request_id)
        if duplicate is not None:
            return ScanResult.accepted(duplicate, duplicate=True)

        now = self._clock.now().astimezone(UTC)
        if not await self._repository.lock_active_kiosk_session(
            challenge.kiosk_session_id, now
        ):
            raise KioskSessionRevoked
        rate_limit_key = self._rate_limit_key(user.user_id)
        if not await self._repository.consume_scan_rate_limit(rate_limit_key, now):
            raise ScanRateLimited
        attendance_date = now.astimezone(self.BUSINESS_TIMEZONE).date()
        await self._repository.lock_student_date(user.user_id, attendance_date)

        duplicate = await self._repository.scan_by_request(user.user_id, request_id)
        if duplicate is not None:
            return ScanResult.accepted(duplicate, duplicate=True)

        latest = await self._repository.latest_non_voided_scan(
            user.user_id, attendance_date
        )
        if latest is not None:
            elapsed = now - latest.scanned_at.astimezone(UTC)
            if elapsed < self.COOLDOWN:
                remaining = max(0.0, (self.COOLDOWN - elapsed).total_seconds())
                return ScanResult.cooldown(latest, remaining=remaining)

        direction = (
            Direction.OUT
            if latest is not None and latest.direction == Direction.IN
            else Direction.IN
        )
        inserted = await self._repository.insert_qr_scan(
            student_id=user.user_id,
            attendance_date=attendance_date,
            direction=direction,
            scanned_at=now,
            kiosk_session_id=challenge.kiosk_session_id,
            request_id=request_id,
            qr_issued_at=challenge.issued_at,
        )
        if inserted is not None:
            return ScanResult.accepted(inserted, duplicate=False)

        raced_duplicate = await self._repository.scan_by_request(
            user.user_id, request_id
        )
        if raced_duplicate is None:
            raise RuntimeError("Attendance idempotency conflict returned no row")
        return ScanResult.accepted(raced_duplicate, duplicate=True)

    def _rate_limit_key(self, student_id: UUID) -> str:
        digest = hmac.new(
            self._rate_limit_secret.encode(),
            f"attendance-scan\0{student_id}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"hmac-sha256:{digest}"

    async def correct(
        self,
        actor: AuthenticatedUser,
        correction: AttendanceCorrectionInput,
    ) -> AttendanceScan:
        if await self._repository.staff_role(actor.user_id) not in {
            "teacher",
            "admin",
        }:
            raise ApiError("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403)

        if correction.mode == CorrectionMode.VOID:
            scan_id = correction.scan_id
            if scan_id is None:
                raise RuntimeError("Validated VOID correction is missing scan_id")
            target = await self._repository.scan_by_id(scan_id)
            if target is None:
                raise ApiError(
                    "ATTENDANCE_SCAN_NOT_FOUND",
                    "수정할 출결 기록을 찾을 수 없습니다.",
                    404,
                )
            await self._repository.lock_student_date(
                target.student_id, target.attendance_date
            )
            corrected = await self._repository.void_scan(
                scan_id,
                actor_id=actor.user_id,
                reason=correction.reason,
                now=self._clock.now().astimezone(UTC),
            )
            if corrected is None:
                raise ApiError(
                    "ATTENDANCE_SCAN_NOT_FOUND",
                    "수정할 출결 기록을 찾을 수 없습니다.",
                    404,
                )
            details: dict[str, object] = {
                "mode": CorrectionMode.VOID.value,
                "reason": correction.reason,
            }
        else:
            student_id = correction.student_id
            direction = correction.direction
            scanned_at = correction.scanned_at
            if student_id is None or direction is None or scanned_at is None:
                raise RuntimeError("Validated MANUAL correction is incomplete")
            if not await self._repository.student_exists(student_id):
                raise ApiError(
                    "STUDENT_NOT_FOUND",
                    "학생 정보를 찾을 수 없습니다.",
                    404,
                )
            manual_date = scanned_at.astimezone(self.BUSINESS_TIMEZONE).date()
            await self._repository.lock_student_date(student_id, manual_date)
            corrected = await self._repository.insert_manual_scan(
                student_id=student_id,
                direction=direction,
                scanned_at=scanned_at.astimezone(UTC),
                actor_id=actor.user_id,
            )
            details = {
                "mode": CorrectionMode.MANUAL.value,
                "reason": correction.reason,
                "direction": direction.value,
            }

        await self._repository.append_correction_audit(
            actor_id=actor.user_id,
            mode=correction.mode,
            scan_id=corrected.id,
            details=details,
        )
        return corrected
