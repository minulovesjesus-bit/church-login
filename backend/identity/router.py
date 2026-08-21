from typing import Annotated, Any

from fastapi import APIRouter, Depends, status

from backend.core.auth import get_current_user, require_google_user
from backend.core.config import settings
from backend.core.db import get_database_connection
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.repository import IdentityRepository
from backend.identity.schemas import (
    CurrentIdentityView,
    StaffRole,
    StudentProfileInput,
    StudentProfileView,
    TeacherApplicationInput,
    TeacherApplicationStateView,
    TeacherApplicationView,
)
from backend.identity.service import IdentityService, StaffService

router = APIRouter(prefix="/api")


DatabaseConnection = Annotated[
    Any, Depends(get_database_connection, scope="function")
]


async def get_identity_repository(
    connection: DatabaseConnection,
) -> IdentityRepository:
    return IdentityRepository(connection)


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
    user: CurrentUser,
    repository: IdentityRepositoryDependency,
) -> AuthenticatedUser:
    if user.provider != "google":
        raise ApiError("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403)
    staff_service = StaffService(
        repository, initial_admin_email=settings.initial_admin_email
    )
    await staff_service.bootstrap_initial_admin(user)
    if await repository.staff_role(user.user_id) != StaffRole.ADMIN:
        raise ApiError("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403)
    return user


@router.get("/me", response_model=CurrentIdentityView)
async def current_identity(
    user: CurrentUser,
    service: IdentityServiceDependency,
    staff_service: StaffServiceDependency,
) -> dict[str, object]:
    await staff_service.bootstrap_initial_admin(user)
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
