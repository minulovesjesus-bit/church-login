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

TEST_SUPABASE_URL = "https://test-project.supabase.co"


@pytest.fixture
async def configured_auth(
    monkeypatch: pytest.MonkeyPatch,
    rsa_jwks: tuple[rsa.RSAPrivateKey, dict[str, Any]],
) -> tuple[JwksVerifier, list[int], list[float]]:
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
    return verifier, fetch_count, clock


async def test_valid_jwt_returns_minimal_authenticated_identity(
    client: httpx.AsyncClient,
    configured_auth: tuple[JwksVerifier, list[int], list[float]],
    token_factory: Callable[..., str],
) -> None:
    user_id = uuid4()
    token = token_factory("google", True, user_id)

    response = await client.get(
        "/api/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert response.json() == {
        "user_id": str(user_id),
        "email": "student@example.com",
        "provider": "google",
        "email_verified": True,
    }


async def test_expired_jwt_returns_stable_error(
    client: httpx.AsyncClient,
    configured_auth: tuple[JwksVerifier, list[int], list[float]],
    token_factory: Callable[..., str],
) -> None:
    token = token_factory(
        "google", True, uuid4(), expires_in=timedelta(seconds=-1)
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
    configured_auth: tuple[JwksVerifier, list[int], list[float]],
    token_factory: Callable[..., str],
    payload_overrides: dict[str, Any],
    algorithm: str,
    signing_key: rsa.RSAPrivateKey | str | bytes | None,
) -> None:
    token = token_factory(
        "google",
        True,
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
    configured_auth: tuple[JwksVerifier, list[int], list[float]],
    token_factory: Callable[..., str],
) -> None:
    attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = token_factory(
        "google", True, uuid4(), signing_key=attacker_key
    )

    response = await client.get(
        "/api/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


async def test_teacher_dependency_rejects_password_provider_from_trusted_claims(
    client: httpx.AsyncClient,
    configured_auth: tuple[JwksVerifier, list[int], list[float]],
    token_factory: Callable[..., str],
) -> None:
    token = token_factory("email", True, uuid4())

    response = await client.post(
        "/api/teacher-applications",
        headers={"Authorization": f"Bearer {token}"},
        json={"provider": "google"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "GOOGLE_AUTH_REQUIRED"


async def test_jwks_cache_reuses_keys_only_until_its_ttl(
    configured_auth: tuple[JwksVerifier, list[int], list[float]],
    token_factory: Callable[..., str],
) -> None:
    verifier, fetch_count, clock = configured_auth
    token = token_factory("google", True, uuid4())

    first_claims = await verifier.verify(token)
    second_claims = await verifier.verify(token)
    clock[0] += 61
    refreshed_claims = await verifier.verify(token)

    assert UUID(first_claims["sub"])
    assert second_claims["sub"] == first_claims["sub"]
    assert refreshed_claims["sub"] == first_claims["sub"]
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
    payload_token = token_factory("google", True, uuid4())
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
