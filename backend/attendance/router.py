from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from backend.attendance.repository import AttendanceRepository
from backend.attendance.schemas import (
    AttendanceCorrectionInput,
    AttendanceScanView,
    ScanInput,
    ScanResult,
)
from backend.attendance.service import AttendanceService, ScanRateLimited
from backend.core.auth import get_current_user
from backend.core.config import settings
from backend.core.db import application_transaction
from backend.core.errors import ApiError, safe_error_response
from backend.identity.models import AuthenticatedUser
from backend.identity.router import require_teacher
from backend.kiosk.repository import KioskRepository
from backend.kiosk.service import KioskSessionService

router = APIRouter(prefix="/api")


async def get_attendance_repository() -> AsyncIterator[AttendanceRepository]:
    async with application_transaction() as connection:
        yield AttendanceRepository(connection)


AttendanceRepositoryDependency = Annotated[
    AttendanceRepository, Depends(get_attendance_repository, scope="function")
]


async def get_attendance_service(
    repository: AttendanceRepositoryDependency,
) -> AttendanceService:
    if (
        not settings.kiosk_password_hash
        or not settings.kiosk_cookie_secret
        or not settings.qr_signing_secret
    ):
        raise RuntimeError("Kiosk security configuration is required")
    kiosk_service = KioskSessionService(
        KioskRepository(repository.connection),
        password_hash=settings.kiosk_password_hash.get_secret_value(),
        cookie_secret=settings.kiosk_cookie_secret.get_secret_value(),
        qr_signing_secret=settings.qr_signing_secret.get_secret_value(),
    )
    return AttendanceService(
        repository,
        kiosk_service,
        rate_limit_secret=settings.kiosk_cookie_secret.get_secret_value(),
    )


AttendanceServiceDependency = Annotated[
    AttendanceService, Depends(get_attendance_service, scope="function")
]
CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]
TeacherUser = Annotated[AuthenticatedUser, Depends(require_teacher, scope="function")]


@router.post("/attendance/scan", response_model=ScanResult)
async def scan_attendance(
    scan_input: ScanInput,
    request: Request,
    user: CurrentUser,
    service: AttendanceServiceDependency,
) -> ScanResult | Response:
    try:
        return await service.scan(user, scan_input.qr_token, scan_input.request_id)
    except ApiError as error:
        return safe_error_response(
            request,
            code=error.code,
            message=error.message,
            status_code=error.status_code,
            headers={"Retry-After": "60"}
            if isinstance(error, ScanRateLimited)
            else None,
        )


@router.post(
    "/teacher/attendance/corrections",
    response_model=AttendanceScanView,
)
async def correct_attendance(
    correction: AttendanceCorrectionInput,
    teacher: TeacherUser,
    service: AttendanceServiceDependency,
) -> AttendanceScanView:
    corrected = await service.correct(teacher, correction)
    return AttendanceScanView.model_validate(corrected)
