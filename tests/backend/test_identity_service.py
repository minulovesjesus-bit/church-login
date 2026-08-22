import os
from datetime import date, datetime
from urllib.parse import urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

import psycopg
import pytest

from backend.core.config import settings
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.repository import IdentityRepository, StudentProfileRecord
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


async def test_live_student_onboarding_returns_profile_fields_in_schema_order() -> None:
    database_url = os.environ.get("TEST_DATABASE_URL") or settings.database_url
    if database_url is None or urlsplit(database_url).hostname not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        pytest.skip("A local TEST_DATABASE_URL is required")
    user = AuthenticatedUser(
        user_id=uuid4(),
        email="profile-order@example.test",
        provider="password",
        email_verified=True,
    )
    connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        await connection.execute("insert into auth.users (id) values (%s)", (user.user_id,))

        profile = await IdentityService(IdentityRepository(connection)).upsert_student_profile(
            user,
            name="필드 순서 학생",
            birth_date=date(2012, 4, 5),
            phone="01011111003",
            guardian_phone="01099990003",
        )

        assert profile.birth_date == date(2012, 4, 5)
        assert profile.phone == "01011111003"
        assert profile.guardian_phone == "01099990003"
    finally:
        await connection.rollback()
        await connection.close()


async def test_student_upsert_sets_the_database_transaction_to_seoul() -> None:
    database_url = os.environ.get("TEST_DATABASE_URL") or settings.database_url
    if database_url is None or urlsplit(database_url).hostname not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        pytest.skip("A local TEST_DATABASE_URL is required")
    user = AuthenticatedUser(
        user_id=uuid4(),
        email="seoul-boundary@example.test",
        provider="password",
        email_verified=True,
    )
    connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        await connection.execute("set local timezone to 'UTC'")
        await connection.execute("insert into auth.users (id) values (%s)", (user.user_id,))
        seoul_today = datetime.now(ZoneInfo("Asia/Seoul")).date()

        await IdentityRepository(connection).upsert_student_profile(
            user,
            name="서울 경계 학생",
            birth_date=seoul_today,
            phone="01011111004",
            guardian_phone="01099990004",
        )
        timezone = await connection.execute("show timezone")

        assert await timezone.fetchone() == ("Asia/Seoul",)
    finally:
        await connection.rollback()
        await connection.close()
