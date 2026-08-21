from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status

from backend.core.auth import get_current_user, require_google_user
from backend.core.config import settings
from backend.core.db import application_transaction
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.repository import IdentityRepository
from backend.identity.schemas import (
    CurrentIdentityView,
    RejectTeacherApplicationInput,
    StaffMemberView,
    StaffRole,
    StaffRoleInput,
    StudentProfileInput,
    StudentProfileView,
    TeacherApplicationInput,
    TeacherApplicationStateView,
    TeacherApplicationView,
)
from backend.identity.service import IdentityService, StaffService

router = APIRouter(prefix="/api")


async def get_identity_repository() -> AsyncIterator[IdentityRepository]:
    async with application_transaction() as connection:
        yield IdentityRepository(connection)


CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]
GoogleUser = Annotated[AuthenticatedUser, Depends(require_google_user)]
IdentityRepositoryDependency = Annotated[
    IdentityRepository, Depends(get_identity_repository, scope="function")
]


async def get_identity_service(
    repository: IdentityRepositoryDependency,
) -> IdentityService:
    return IdentityService(repository)


async def get_staff_service(
    repository: IdentityRepositoryDependency,
) -> StaffService:
    return StaffService(repository, initial_admin_email=settings.initial_admin_email)


IdentityServiceDependency = Annotated[
    IdentityService, Depends(get_identity_service, scope="function")
]
StaffServiceDependency = Annotated[
    StaffService, Depends(get_staff_service, scope="function")
]


async def require_teacher(
    user: GoogleUser,
    repository: IdentityRepositoryDependency,
) -> AuthenticatedUser:
    staff_service = StaffService(
        repository, initial_admin_email=settings.initial_admin_email
    )
    await staff_service.bootstrap_initial_admin(user)
    if await repository.staff_role(user.user_id) not in {
        StaffRole.TEACHER,
        StaffRole.ADMIN,
    }:
        raise ApiError("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403)
    return user


async def require_admin(
    user: GoogleUser,
    repository: IdentityRepositoryDependency,
) -> AuthenticatedUser:
    staff_service = StaffService(
        repository, initial_admin_email=settings.initial_admin_email
    )
    await staff_service.bootstrap_initial_admin(user)
    if await repository.staff_role(user.user_id) != StaffRole.ADMIN:
        raise ApiError("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403)
    return user


AdminUser = Annotated[AuthenticatedUser, Depends(require_admin, scope="function")]


@router.get("/me", response_model=CurrentIdentityView)
async def current_identity(
    user: CurrentUser, service: IdentityServiceDependency
) -> dict[str, object]:
    return await service.current_identity(user)


@router.post(
    "/students/profile", response_model=StudentProfileView, status_code=status.HTTP_201_CREATED
)
async def create_student_profile(
    profile_input: StudentProfileInput,
    user: CurrentUser,
    service: IdentityServiceDependency,
) -> StudentProfileView:
    return await service.upsert_student_profile(user, **profile_input.model_dump())


@router.patch("/students/profile", response_model=StudentProfileView)
async def update_student_profile(
    profile_input: StudentProfileInput,
    user: CurrentUser,
    service: IdentityServiceDependency,
) -> StudentProfileView:
    return await service.upsert_student_profile(user, **profile_input.model_dump())


@router.post(
    "/teacher-applications",
    response_model=TeacherApplicationView,
    status_code=status.HTTP_201_CREATED,
)
async def create_teacher_application(
    application_input: TeacherApplicationInput,
    user: GoogleUser,
    service: StaffServiceDependency,
) -> TeacherApplicationView:
    return await service.apply(user, **application_input.model_dump())


@router.get(
    "/teacher-applications/me", response_model=TeacherApplicationStateView
)
async def current_teacher_application(
    user: GoogleUser,
    service: StaffServiceDependency,
) -> TeacherApplicationStateView:
    return await service.application_state(user)


@router.get(
    "/admin/teacher-applications", response_model=list[TeacherApplicationView]
)
async def pending_teacher_applications(
    _admin: AdminUser,
    service: StaffServiceDependency,
) -> list[TeacherApplicationView]:
    return await service.pending_applications()


@router.post(
    "/admin/teacher-applications/{application_id}/approve",
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
    "/admin/teacher-applications/{application_id}/reject",
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


@router.get("/admin/staff", response_model=list[StaffMemberView])
async def staff_members(
    _admin: AdminUser,
    service: StaffServiceDependency,
) -> list[StaffMemberView]:
    return await service.staff_members()


@router.patch("/admin/staff/{user_id}/role", response_model=StaffMemberView)
async def change_staff_role(
    user_id: UUID,
    role_input: StaffRoleInput,
    admin: AdminUser,
    service: StaffServiceDependency,
) -> StaffMemberView:
    return await service.set_role(admin.user_id, user_id, role_input.role.value)
