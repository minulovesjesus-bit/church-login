from datetime import date
from uuid import uuid4

import pytest

from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.repository import StudentProfileRecord
from backend.identity.service import IdentityService


class RecordingStudentRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[AuthenticatedUser, object]] = []

    async def upsert_student_profile(
        self, user: AuthenticatedUser, **profile_input: object
    ) -> StudentProfileRecord:
        self.calls.append((user, profile_input))
        return StudentProfileRecord(
            user_id=user.user_id,
            email=user.email,
            name=str(profile_input["name"]),
            birth_date=profile_input["birth_date"],
            phone=str(profile_input["phone"]),
            guardian_phone=str(profile_input["guardian_phone"]),
            include_in_statistics=True,
        )


@pytest.fixture
def verified_student() -> AuthenticatedUser:
    return AuthenticatedUser(
        user_id=uuid4(),
        email="student@example.com",
        provider="password",
        email_verified=True,
    )


@pytest.fixture
def identity_service() -> IdentityService:
    return IdentityService(RecordingStudentRepository())


async def test_student_onboarding_creates_normalized_profile(
    identity_service: IdentityService, verified_student: AuthenticatedUser
) -> None:
    profile = await identity_service.upsert_student_profile(
        verified_student,
        name=" 김민준 ",
        birth_date=date(2012, 4, 3),
        phone="010-1234-5678",
        guardian_phone="010-9876-5432",
    )

    assert profile.name == "김민준"
    assert profile.phone == "01012345678"
    assert profile.guardian_phone == "01098765432"
    assert profile.include_in_statistics is True


async def test_unverified_password_user_cannot_create_profile(
    identity_service: IdentityService
) -> None:
    user = AuthenticatedUser(
        user_id=uuid4(),
        email="unverified@example.com",
        provider="password",
        email_verified=False,
    )

    with pytest.raises(ApiError) as error:
        await identity_service.upsert_student_profile(
            user,
            name="미확인",
            birth_date=date(2012, 4, 3),
            phone="01012345678",
            guardian_phone="01098765432",
        )

    assert error.value.code == "EMAIL_NOT_VERIFIED"


async def test_google_user_can_create_profile_without_email_confirmation(
    identity_service: IdentityService
) -> None:
    user = AuthenticatedUser(
        user_id=uuid4(),
        email="google@example.com",
        provider="google",
        email_verified=False,
    )

    profile = await identity_service.upsert_student_profile(
        user,
        name="구글 학생",
        birth_date=date(2012, 4, 3),
        phone="01012345678",
        guardian_phone="01098765432",
    )

    assert profile.name == "구글 학생"
