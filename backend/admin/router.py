from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status

from backend.identity.models import AuthenticatedUser
from backend.identity.router import (
    StaffServiceDependency,
    require_admin,
)
from backend.identity.schemas import (
    RejectTeacherApplicationInput,
    StaffMemberView,
    StaffRoleInput,
    TeacherApplicationView,
)
from backend.kiosk.router import KioskServiceDependency
from backend.kiosk.schemas import AdminKioskSessionView

router = APIRouter(prefix="/api/admin")
AdminUser = Annotated[AuthenticatedUser, Depends(require_admin, scope="function")]


def _disable_storage(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


@router.get("/teacher-applications", response_model=list[TeacherApplicationView])
async def pending_teacher_applications(
    response: Response,
    _admin: AdminUser,
    service: StaffServiceDependency,
) -> list[TeacherApplicationView]:
    _disable_storage(response)
    return await service.pending_applications()


@router.post(
    "/teacher-applications/{application_id}/approve",
    response_model=TeacherApplicationView,
)
async def approve_teacher_application(
    application_id: UUID,
    admin: AdminUser,
    service: StaffServiceDependency,
) -> TeacherApplicationView:
    return await service.decide_application(
        admin.user_id, application_id, decision="approved"
    )


@router.post(
    "/teacher-applications/{application_id}/reject",
    response_model=TeacherApplicationView,
)
async def reject_teacher_application(
    application_id: UUID,
    rejection: RejectTeacherApplicationInput,
    admin: AdminUser,
    service: StaffServiceDependency,
) -> TeacherApplicationView:
    return await service.decide_application(
        admin.user_id,
        application_id,
        decision="rejected",
        rejection_reason=rejection.rejection_reason,
    )


@router.get("/staff", response_model=list[StaffMemberView])
async def staff_members(
    response: Response,
    _admin: AdminUser,
    service: StaffServiceDependency,
) -> list[StaffMemberView]:
    _disable_storage(response)
    return await service.staff_members()


@router.patch("/staff/{user_id}/role", response_model=StaffMemberView)
async def change_staff_role(
    user_id: UUID,
    role_input: StaffRoleInput,
    admin: AdminUser,
    service: StaffServiceDependency,
) -> StaffMemberView:
    return await service.set_role(admin.user_id, user_id, role_input.role.value)


@router.get("/kiosk-sessions", response_model=list[AdminKioskSessionView])
async def list_kiosk_sessions(
    response: Response,
    _admin: AdminUser,
    service: KioskServiceDependency,
) -> list[AdminKioskSessionView]:
    _disable_storage(response)
    sessions = await service.admin_sessions()
    return [AdminKioskSessionView.model_validate(session) for session in sessions]


@router.delete(
    "/kiosk-sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_kiosk_session(
    session_id: UUID,
    admin: AdminUser,
    service: KioskServiceDependency,
) -> None:
    await service.revoke_as_admin(session_id, admin.user_id)
