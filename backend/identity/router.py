from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, status

from backend.core.auth import get_current_user
from backend.core.db import application_transaction
from backend.identity.models import AuthenticatedUser
from backend.identity.repository import IdentityRepository
from backend.identity.schemas import (
    CurrentIdentityView,
    StudentProfileInput,
    StudentProfileView,
)
from backend.identity.service import IdentityService

router = APIRouter(prefix="/api")


async def get_identity_service() -> AsyncIterator[IdentityService]:
    async with application_transaction() as connection:
        yield IdentityService(IdentityRepository(connection))


CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]
IdentityServiceDependency = Annotated[IdentityService, Depends(get_identity_service)]


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
