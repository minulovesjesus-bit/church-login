import asyncio
from collections.abc import Callable
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from backend.core import auth
from backend.core.auth import JwksVerifier
from backend.core.config import Settings
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.router import get_identity_service, get_staff_service
from backend.identity.schemas import TeacherApplicationStatus, TeacherApplicationView
from backend.main import app

TEST_SUPABASE_URL = "https://test-project.supabase.co"


def auth_user_payload(
    user_id: str,
    *,
    email: str = "student@example.com",
    email_confirmed_at: str | None = "2026-08-21T05:00:00Z",
    identity_providers: list[str] | None = None,
) -> dict[str, Any]:
    providers = identity_providers if identity_providers is not None else ["google"]
    identities = [
        {
            "id": f"identity-{index}",
            "user_id": user_id,
            "identity_data": {"email": email, "email_verified": True},
            "provider": provider,
            "created_at": "2026-08-20T05:00:00Z",
            "last_sign_in_at": "2026-08-21T05:00:00Z",
            "updated_at": "2026-08-21T05:00:00Z",
        }
        for index, provider in enumerate(providers)
    ]
    return {
        "id": user_id,
        "aud": "authenticated",
        "role": "authenticated",
        "email": email,
        "email_confirmed_at": email_confirmed_at,
        "phone": "",
        "confirmed_at": email_confirmed_at,
        "last_sign_in_at": "2026-08-21T05:00:00Z",
        "app_metadata": {
            "provider": providers[0] if providers else "email",
            "providers": providers,
        },
        "user_metadata": {"provider": "untrusted-client-value"},
        "identities": identities,
        "is_anonymous": False,
        "created_at": "2026-08-20T05:00:00Z",
        "updated_at": "2026-08-21T05:00:00Z",
    }


class StubAuthUserResolver:
    def __init__(self) -> None:
        self.email_confirmed_at: str | None = "2026-08-21T05:00:00Z"
        self.identity_providers = ["google"]

    async def resolve(self, token: str) -> dict[str, Any]:
        claims = jwt.decode(token, options={"verify_signature": False})
        return auth_user_payload(
            claims["sub"],
            email=claims["email"],
            email_confirmed_at=self.email_confirmed_at,
            identity_providers=self.identity_providers,
        )


class EmptyIdentityService:
    async def current_identity(self, user: Any) -> dict[str, object]:
        return {
            "user_id": str(user.user_id),
            "email": user.email,
            "provider": user.provider,
            "email_verified": user.email_verified,
            "onboarding_completed": False,
            "capabilities": {"student": False, "teacher": False, "admin": False},
        }


class EmptyStaffService:
    async def bootstrap_initial_admin(self, _user: Any) -> bool:
        return False


def test_backend_auth_reuses_configured_supabase_publishable_key() -> None:
    configured = Settings(
        _env_file=None,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="test-publishable-key",
    )

    assert configured.supabase_publishable_key == "test-publishable-key"


@pytest.fixture
async def configured_auth(
    monkeypatch: pytest.MonkeyPatch,
    rsa_jwks: tuple[rsa.RSAPrivateKey, dict[str, Any]],
) -> tuple[JwksVerifier, list[int], list[float], StubAuthUserResolver]:
    _, jwks = rsa_jwks
    fetch_count = [0]
    clock = [100.0]

    async def fetch_jwks() -> dict[str, Any]:
        fetch_count[0] += 1
        return jwks

    verifier = JwksVerifier(
        supabase_url=TEST_SUPABASE_URL,
        audience="authenticated",
        cache_ttl_seconds=60,
        max_cached_keys=4,
        fetch_jwks=fetch_jwks,
        time_source=lambda: clock[0],
    )
    monkeypatch.setattr(auth, "jwt_verifier", verifier)
    auth_user_resolver = StubAuthUserResolver()
    monkeypatch.setattr(
        auth, "auth_user_resolver", auth_user_resolver, raising=False
    )
    app.dependency_overrides[get_identity_service] = EmptyIdentityService
    app.dependency_overrides[get_staff_service] = EmptyStaffService
    try:
        yield verifier, fetch_count, clock, auth_user_resolver
    finally:
        app.dependency_overrides.pop(get_identity_service, None)
        app.dependency_overrides.pop(get_staff_service, None)


async def test_valid_jwt_returns_minimal_authenticated_identity(
    client: httpx.AsyncClient,
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
) -> None:
    user_id = uuid4()
    token = token_factory("email", "oauth", user_id)

    response = await client.get(
        "/api/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert response.json() == {
        "user_id": str(user_id),
        "email": "student@example.com",
        "provider": "google",
        "email_verified": True,
        "onboarding_completed": False,
        "capabilities": {"student": False, "teacher": False, "admin": False},
    }


async def test_expired_jwt_returns_stable_error(
    client: httpx.AsyncClient,
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
) -> None:
    token = token_factory(
        "email", "oauth", uuid4(), expires_in=timedelta(seconds=-1)
    )

    response = await client.get(
        "/api/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


@pytest.mark.parametrize(
    ("payload_overrides", "algorithm", "signing_key"),
    [
        ({"iss": "https://attacker.example/auth/v1"}, "RS256", None),
        ({"aud": "service_role"}, "RS256", None),
        ({"sub": "not-a-uuid"}, "RS256", None),
        ({}, "HS256", "attacker-controlled-secret-that-is-long-enough"),
    ],
    ids=["wrong-issuer", "wrong-audience", "invalid-subject", "disallowed-algorithm"],
)
async def test_invalid_jwt_constraints_are_rejected(
    client: httpx.AsyncClient,
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
    payload_overrides: dict[str, Any],
    algorithm: str,
    signing_key: rsa.RSAPrivateKey | str | bytes | None,
) -> None:
    token = token_factory(
        "email",
        "oauth",
        uuid4(),
        payload_overrides=payload_overrides,
        algorithm=algorithm,
        signing_key=signing_key,
    )

    response = await client.get(
        "/api/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


async def test_jwt_signed_by_an_unknown_private_key_is_rejected(
    client: httpx.AsyncClient,
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
) -> None:
    attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = token_factory(
        "email", "oauth", uuid4(), signing_key=attacker_key
    )

    response = await client.get(
        "/api/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


async def test_google_first_account_authenticated_by_password_is_rejected(
    client: httpx.AsyncClient,
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
) -> None:
    token = token_factory("google", "password", uuid4())

    response = await client.post(
        "/api/teacher-applications",
        headers={"Authorization": f"Bearer {token}"},
        json={"provider": "google"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "GOOGLE_AUTH_REQUIRED"


async def test_oauth_session_with_authoritative_google_identity_is_accepted(
    client: httpx.AsyncClient,
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
) -> None:
    token = token_factory("email", "oauth", uuid4())

    class AcceptingStaffService:
        async def apply(
            self, user: AuthenticatedUser, *, name: str, phone: str
        ) -> TeacherApplicationView:
            return TeacherApplicationView(
                id=uuid4(),
                user_id=user.user_id,
                email=user.email,
                name=name,
                phone=phone,
                status=TeacherApplicationStatus.PENDING,
                rejection_reason=None,
            )

    app.dependency_overrides[get_staff_service] = lambda: AcceptingStaffService()
    try:
        response = await client.post(
            "/api/teacher-applications",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "김교사", "phone": "01011112222"},
        )
    finally:
        app.dependency_overrides.pop(get_staff_service, None)

    assert response.status_code == 201
    assert response.json()["status"] == "pending"


async def test_oauth_session_without_authoritative_google_identity_is_rejected(
    client: httpx.AsyncClient,
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
) -> None:
    *_, auth_user_resolver = configured_auth
    auth_user_resolver.identity_providers = ["github"]
    token = token_factory("google", "oauth", uuid4())

    response = await client.post(
        "/api/teacher-applications",
        headers={"Authorization": f"Bearer {token}"},
        json={"provider": "google"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "GOOGLE_AUTH_REQUIRED"


async def test_email_confirmation_comes_from_authoritative_auth_user(
    client: httpx.AsyncClient,
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
) -> None:
    user_id = uuid4()
    token = token_factory("email", "password", user_id)

    response = await client.get(
        "/api/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert response.json()["email_verified"] is True


async def test_unconfirmed_auth_user_is_not_marked_verified(
    client: httpx.AsyncClient,
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
) -> None:
    *_, auth_user_resolver = configured_auth
    auth_user_resolver.email_confirmed_at = None
    token = token_factory("email", "password", uuid4())

    response = await client.get(
        "/api/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert response.json()["email_verified"] is False


async def test_auth_user_resolver_uses_official_endpoint_headers_and_timeout(
    token_factory: Callable[..., str],
) -> None:
    token = token_factory("email", "oauth", uuid4())
    expected_user = await StubAuthUserResolver().resolve(token)

    async def auth_endpoint(request: httpx.Request) -> httpx.Response:
        if (
            request.url
            != "https://test-project.supabase.co/auth/v1/user"
            or request.headers.get("Authorization") != f"Bearer {token}"
            or request.headers.get("apikey") != "test-publishable-key"
            or request.extensions["timeout"]["read"] != 2.0
        ):
            return httpx.Response(401, json={"message": "invalid request"})
        return httpx.Response(200, json=expected_user)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(auth_endpoint)
    ) as http_client:
        resolver = auth.SupabaseAuthUserResolver(
            supabase_url=TEST_SUPABASE_URL,
            publishable_key="test-publishable-key",
            timeout_seconds=2,
            http_client=http_client,
        )

        resolved_user = await resolver.resolve(token)

    assert resolved_user == expected_user


async def test_auth_user_cache_is_bounded_and_reuses_recent_tokens() -> None:
    fetched_tokens: list[str] = []
    auth_user = auth_user_payload(
        "00000000-0000-4000-8000-000000000001",
        identity_providers=[],
    )

    async def fetch_auth_user(token: str) -> dict[str, Any]:
        fetched_tokens.append(token)
        return auth_user

    resolver = auth.SupabaseAuthUserResolver(
        supabase_url=TEST_SUPABASE_URL,
        publishable_key="test-publishable-key",
        cache_ttl_seconds=30,
        max_cached_users=2,
        fetch_auth_user=fetch_auth_user,
        time_source=lambda: 100.0,
    )

    await resolver.resolve("token-a")
    await resolver.resolve("token-a")
    await resolver.resolve("token-b")
    await resolver.resolve("token-c")
    await resolver.resolve("token-a")

    assert fetched_tokens == ["token-a", "token-b", "token-c", "token-a"]


async def test_auth_user_resolver_does_not_serialize_different_tokens() -> None:
    second_request_started = asyncio.Event()
    auth_user = auth_user_payload(
        "00000000-0000-4000-8000-000000000001",
        identity_providers=[],
    )

    async def fetch_auth_user(token: str) -> dict[str, Any]:
        if token == "token-a":
            await asyncio.wait_for(second_request_started.wait(), timeout=0.2)
        else:
            second_request_started.set()
        return auth_user

    resolver = auth.SupabaseAuthUserResolver(
        supabase_url=TEST_SUPABASE_URL,
        publishable_key="test-publishable-key",
        fetch_auth_user=fetch_auth_user,
    )

    first, second = await asyncio.gather(
        resolver.resolve("token-a"),
        resolver.resolve("token-b"),
    )

    assert first == auth_user
    assert second == auth_user


async def test_auth_user_endpoint_failure_returns_safe_auth_error(
    client: httpx.AsyncClient,
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unavailable_auth_server(_token: str) -> dict[str, Any]:
        raise httpx.ConnectError("internal-hostname:54321 refused")

    resolver = auth.SupabaseAuthUserResolver(
        supabase_url=TEST_SUPABASE_URL,
        publishable_key="test-publishable-key",
        fetch_auth_user=unavailable_auth_server,
    )
    monkeypatch.setattr(auth, "auth_user_resolver", resolver)
    token = token_factory("email", "oauth", uuid4())

    response = await client.get(
        "/api/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
    assert "internal-hostname" not in response.text


async def test_auth_user_network_failure_backoff_is_shared_across_tokens() -> None:
    fetched_tokens: list[str] = []
    clock = [100.0]

    async def unavailable_auth_server(token: str) -> dict[str, Any]:
        fetched_tokens.append(token)
        raise httpx.ConnectError("Auth server unavailable")

    resolver = auth.SupabaseAuthUserResolver(
        supabase_url=TEST_SUPABASE_URL,
        publishable_key="test-publishable-key",
        fetch_auth_user=unavailable_auth_server,
        time_source=lambda: clock[0],
    )

    with pytest.raises(ApiError):
        await resolver.resolve("token-a")
    with pytest.raises(ApiError):
        await resolver.resolve("token-b")
    assert fetched_tokens == ["token-a"]

    clock[0] += 6
    with pytest.raises(ApiError):
        await resolver.resolve("token-b")
    assert fetched_tokens == ["token-a", "token-b"]


@pytest.mark.parametrize("status_code", [429, 503], ids=["rate-limited", "outage"])
async def test_transient_auth_http_status_uses_shared_bounded_backoff(
    status_code: int,
) -> None:
    request_count = [0]
    clock = [100.0]

    async def transient_auth_response(request: httpx.Request) -> httpx.Response:
        request_count[0] += 1
        return httpx.Response(
            status_code,
            json={"message": f"upstream rejected {request.headers['Authorization']}"},
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(transient_auth_response)
    ) as http_client:
        resolver = auth.SupabaseAuthUserResolver(
            supabase_url=TEST_SUPABASE_URL,
            publishable_key="test-publishable-key",
            http_client=http_client,
            time_source=lambda: clock[0],
        )

        with pytest.raises(ApiError) as first_error:
            await resolver.resolve("do-not-leak-token-a")
        with pytest.raises(ApiError) as backoff_error:
            await resolver.resolve("do-not-leak-token-b")

        assert request_count == [1]
        assert str(first_error.value) == "AUTH_REQUIRED"
        assert str(backoff_error.value) == "AUTH_REQUIRED"

        clock[0] += 6
        with pytest.raises(ApiError) as retry_error:
            await resolver.resolve("do-not-leak-token-b")

    assert request_count == [2]
    assert str(retry_error.value) == "AUTH_REQUIRED"


async def test_auth_401_is_token_local_and_does_not_expose_upstream_details() -> None:
    request_count = [0]
    expected_user = auth_user_payload(
        "00000000-0000-4000-8000-000000000001",
        identity_providers=[],
    )

    async def token_specific_auth_response(request: httpx.Request) -> httpx.Response:
        request_count[0] += 1
        if request.headers["Authorization"] == "Bearer rejected-secret-token":
            return httpx.Response(
                401,
                json={"message": "rejected-secret-token was revoked"},
            )
        return httpx.Response(200, json=expected_user)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(token_specific_auth_response)
    ) as http_client:
        resolver = auth.SupabaseAuthUserResolver(
            supabase_url=TEST_SUPABASE_URL,
            publishable_key="test-publishable-key",
            http_client=http_client,
        )

        with pytest.raises(ApiError) as rejected_error:
            await resolver.resolve("rejected-secret-token")
        accepted_user = await resolver.resolve("accepted-token")

    assert request_count == [2]
    assert accepted_user == expected_user
    assert str(rejected_error.value) == "AUTH_REQUIRED"
    assert "rejected-secret-token" not in str(rejected_error.value)


async def test_jwks_cache_reuses_keys_only_until_its_ttl(
    configured_auth: tuple[
        JwksVerifier, list[int], list[float], StubAuthUserResolver
    ],
    token_factory: Callable[..., str],
) -> None:
    verifier, fetch_count, clock, _ = configured_auth
    token = token_factory("email", "oauth", uuid4())

    first_claims = await verifier.verify(token)
    second_claims = await verifier.verify(token)
    clock[0] += 61
    refreshed_claims = await verifier.verify(token)

    assert UUID(first_claims["sub"])
    assert second_claims["sub"] == first_claims["sub"]
    assert refreshed_claims["sub"] == first_claims["sub"]
    assert fetch_count == [2]


async def test_failed_jwks_refresh_is_shared_without_accepting_expired_keys(
    rsa_jwks: tuple[rsa.RSAPrivateKey, dict[str, Any]],
    token_factory: Callable[..., str],
) -> None:
    _, jwks = rsa_jwks
    fetch_count = [0]
    fail_refresh = [False]
    clock = [100.0]

    async def fetch_jwks() -> dict[str, Any]:
        fetch_count[0] += 1
        await asyncio.sleep(0)
        if fail_refresh[0]:
            raise httpx.ConnectError("JWKS unavailable")
        return jwks

    verifier = JwksVerifier(
        supabase_url=TEST_SUPABASE_URL,
        audience="authenticated",
        cache_ttl_seconds=1,
        fetch_jwks=fetch_jwks,
        time_source=lambda: clock[0],
    )
    token = token_factory("email", "oauth", uuid4())
    await verifier.verify(token)
    clock[0] += 2
    fail_refresh[0] = True

    results = await asyncio.gather(
        *(verifier.verify(token) for _ in range(8)),
        return_exceptions=True,
    )

    assert fetch_count == [2]
    assert all(
        isinstance(result, ApiError) and result.code == "AUTH_REQUIRED"
        for result in results
    )


async def test_failed_jwks_refresh_retries_only_after_bounded_backoff(
    token_factory: Callable[..., str],
) -> None:
    fetch_count = [0]
    clock = [100.0]

    async def fetch_jwks() -> dict[str, Any]:
        fetch_count[0] += 1
        raise httpx.ConnectError("JWKS unavailable")

    verifier = JwksVerifier(
        supabase_url=TEST_SUPABASE_URL,
        audience="authenticated",
        fetch_jwks=fetch_jwks,
        time_source=lambda: clock[0],
    )
    token = token_factory("email", "oauth", uuid4())

    with pytest.raises(ApiError):
        await verifier.verify(token)
    with pytest.raises(ApiError):
        await verifier.verify(token)
    assert fetch_count == [1]

    clock[0] += 6
    with pytest.raises(ApiError):
        await verifier.verify(token)
    assert fetch_count == [2]


async def test_jwks_key_cache_never_exceeds_configured_bound(
    token_factory: Callable[..., str],
) -> None:
    private_keys = [
        rsa.generate_private_key(public_exponent=65537, key_size=2048)
        for _ in range(6)
    ]
    jwks_keys = []
    for index, private_key in enumerate(private_keys):
        jwk = RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
        jwk.update({"kid": f"key-{index}", "use": "sig", "alg": "RS256"})
        jwks_keys.append(jwk)

    async def fetch_jwks() -> dict[str, Any]:
        return {"keys": jwks_keys}

    verifier = JwksVerifier(
        supabase_url=TEST_SUPABASE_URL,
        audience="authenticated",
        max_cached_keys=4,
        fetch_jwks=fetch_jwks,
    )
    payload_token = token_factory("email", "oauth", uuid4())
    payload = jwt.decode(payload_token, options={"verify_signature": False})
    token = jwt.encode(
        payload,
        private_keys[-1],
        algorithm="RS256",
        headers={"kid": "key-5"},
    )

    await verifier.verify(token)

    assert verifier.max_cached_keys == 4
    assert verifier.cached_key_count == verifier.max_cached_keys
