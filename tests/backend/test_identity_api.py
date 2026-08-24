from datetime import date
from uuid import uuid4

import httpx
import pytest

from backend.core.auth import get_current_user
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.router import get_identity_service, get_staff_service
from backend.identity.schemas import StudentProfileView
from backend.main import app


class FakeIdentityService:
    def __init__(self) -> None:
        self.saved: list[tuple[AuthenticatedUser, dict[str, object]]] = []
        self.profile_reads: list[AuthenticatedUser] = []
        self.profile = StudentProfileView(
            name="김민준",
            birth_date=date(2012, 4, 3),
            phone="01012345678",
            guardian_phone="01098765432",
            include_in_statistics=True,
        )

    async def upsert_student_profile(
        self, user: AuthenticatedUser, **profile: object
    ) -> StudentProfileView:
        self.saved.append((user, profile))
        return StudentProfileView(
            name=str(profile["name"]),
            birth_date=date.fromisoformat(str(profile["birth_date"])),
            phone=str(profile["phone"]),
            guardian_phone=str(profile["guardian_phone"]),
            include_in_statistics=True,
        )

    async def current_identity(self, user: AuthenticatedUser) -> dict[str, object]:
        return {
            "user_id": str(user.user_id),
            "email": user.email,
            "provider": user.provider,
            "email_verified": user.email_verified,
            "onboarding_completed": False,
            "capabilities": {"student": False, "teacher": False, "admin": False},
        }

    async def current_student_profile(
        self, user: AuthenticatedUser
    ) -> StudentProfileView:
        self.profile_reads.append(user)
        return self.profile


class FakeStaffService:
    async def bootstrap_initial_admin(self, _user: AuthenticatedUser) -> bool:
        return False


@pytest.fixture
def api_user() -> AuthenticatedUser:
    return AuthenticatedUser(
        user_id=uuid4(),
        email="student@example.com",
        provider="password",
        email_verified=True,
    )


@pytest.fixture
def identity_api(api_user: AuthenticatedUser):
    service = FakeIdentityService()

    async def current_user() -> AuthenticatedUser:
        return api_user

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_identity_service] = lambda: service
    app.dependency_overrides[get_staff_service] = FakeStaffService
    try:
        yield service
    finally:
        app.dependency_overrides.clear()


async def test_profile_get_uses_the_authenticated_user(
    client: httpx.AsyncClient,
    identity_api: FakeIdentityService,
    api_user: AuthenticatedUser,
) -> None:
    response = await client.get("/api/students/profile")

    assert response.status_code == 200
    assert identity_api.profile_reads == [api_user]
    assert response.json() == {
        "name": "김민준",
        "birth_date": "2012-04-03",
        "phone": "01012345678",
        "guardian_phone": "01098765432",
        "include_in_statistics": True,
    }


async def test_profile_endpoint_creates_only_authenticated_users_profile(
    client: httpx.AsyncClient, identity_api: FakeIdentityService, api_user: AuthenticatedUser
) -> None:
    response = await client.post(
        "/api/students/profile",
        json={
            "name": "김민준",
            "birth_date": "2012-04-03",
            "phone": "010-1234-5678",
            "guardian_phone": "010-9876-5432",
            "user_id": str(uuid4()),
        },
    )

    assert response.status_code == 422
    assert identity_api.saved == []


async def test_profile_endpoint_normalizes_and_uses_authenticated_user(
    client: httpx.AsyncClient, identity_api: FakeIdentityService, api_user: AuthenticatedUser
) -> None:
    response = await client.post(
        "/api/students/profile",
        json={
            "name": "김민준",
            "birth_date": "2012-04-03",
            "phone": "010-1234-5678",
            "guardian_phone": "010-9876-5432",
        },
    )

    assert response.status_code == 201
    assert identity_api.saved == [
        (
            api_user,
            {
                "name": "김민준",
                "birth_date": date(2012, 4, 3),
                "phone": "01012345678",
                "guardian_phone": "01098765432",
            },
        )
    ]
    assert response.json()["include_in_statistics"] is True


async def test_profile_patch_uses_the_same_authenticated_user(
    client: httpx.AsyncClient, identity_api: FakeIdentityService, api_user: AuthenticatedUser
) -> None:
    response = await client.patch(
        "/api/students/profile",
        json={
            "name": "수정된 이름",
            "birth_date": "2012-04-03",
            "phone": "010-2222-3333",
            "guardian_phone": "010-4444-5555",
        },
    )

    assert response.status_code == 200
    assert identity_api.saved == [
        (
            api_user,
            {
                "name": "수정된 이름",
                "birth_date": date(2012, 4, 3),
                "phone": "01022223333",
                "guardian_phone": "01044445555",
            },
        )
    ]


async def test_profile_returns_error_when_transaction_teardown_fails(
    client: httpx.AsyncClient, api_user: AuthenticatedUser
) -> None:
    service = FakeIdentityService()

    async def current_user() -> AuthenticatedUser:
        return api_user

    async def failing_transaction_service():
        yield service
        raise ApiError("DATABASE_UNAVAILABLE", "잠시 후 다시 시도해 주세요.", 503)

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_identity_service] = failing_transaction_service
    try:
        response = await client.post(
            "/api/students/profile",
            json={
                "name": "김민준",
                "birth_date": "2012-04-03",
                "phone": "010-1234-5678",
                "guardian_phone": "010-9876-5432",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"


async def test_me_exposes_only_current_users_capabilities(
    client: httpx.AsyncClient, identity_api: FakeIdentityService, api_user: AuthenticatedUser
) -> None:
    response = await client.get("/api/me")

    assert response.status_code == 200
    assert response.json() == {
        "user_id": str(api_user.user_id),
        "email": "student@example.com",
        "provider": "password",
        "email_verified": True,
        "onboarding_completed": False,
        "capabilities": {"student": False, "teacher": False, "admin": False},
    }
