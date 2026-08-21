from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI
from fastapi.security import HTTPAuthorizationCredentials

from backend.core.auth import (
    AUTH_REQUIRED,
    auth_user_resolver,
    bearer,
    get_current_user,
)
from backend.core.config import settings
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from fixtures.identity_environment import require_local_identity_environment


def require_identity_auth_fixture_environment() -> None:
    require_local_identity_environment(
        supabase_url=settings.supabase_url,
        database_urls=(settings.database_url,),
    )


require_identity_auth_fixture_environment()

FIXTURE_USERS = {
    UUID("00000000-0000-4000-8000-000000000101"): (
        "incomplete.student@example.test",
        "email",
    ),
    UUID("00000000-0000-4000-8000-000000000102"): (
        "complete.student@example.test",
        "email",
    ),
    UUID("00000000-0000-4000-8000-000000000201"): (
        "pending.teacher@example.test",
        "google",
    ),
    UUID("00000000-0000-4000-8000-000000000202"): (
        "approved.teacher@example.test",
        "google",
    ),
    UUID("00000000-0000-4000-8000-000000000301"): (
        "admin.identity@example.test",
        "google",
    ),
}


async def get_identity_fixture_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer)
    ] = None,
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise ApiError(*AUTH_REQUIRED)

    auth_user = await auth_user_resolver.resolve(credentials.credentials)
    try:
        user_id = UUID(auth_user["id"])
        email, provider = FIXTURE_USERS[user_id]
        metadata = auth_user["user_metadata"]
        if (
            auth_user["email"] != email
            or not isinstance(metadata, dict)
            or metadata.get("fixture") != "identity-e2e"
        ):
            raise ValueError("Auth user is not an identity fixture")
    except (KeyError, TypeError, ValueError):
        raise ApiError(*AUTH_REQUIRED) from None

    return AuthenticatedUser(
        user_id=user_id,
        email=email,
        provider=provider,
        email_verified=True,
    )


def install_identity_auth_fixtures(app: FastAPI) -> None:
    require_identity_auth_fixture_environment()
    app.dependency_overrides[get_current_user] = get_identity_fixture_user
