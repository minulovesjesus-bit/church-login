import os
from collections.abc import AsyncIterator, Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient
from jwt.algorithms import RSAAlgorithm

from api.index import app


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as test_client:
        yield test_client


@pytest.fixture
def database_transaction() -> Iterator[psycopg.Connection[Any] | None]:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if database_url is None:
        yield None
        return

    connection = psycopg.connect(database_url)
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


@pytest.fixture
def rsa_jwks() -> tuple[rsa.RSAPrivateKey, dict[str, Any]]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    jwk.update({"kid": "test-key", "use": "sig", "alg": "RS256"})
    return private_key, {"keys": [jwk]}


@pytest.fixture
def token_factory(
    rsa_jwks: tuple[rsa.RSAPrivateKey, dict[str, Any]],
) -> Callable[..., str]:
    private_key, _ = rsa_jwks

    def create_token(
        first_provider: str,
        authentication_method: str,
        subject: UUID,
        *,
        expires_in: timedelta = timedelta(minutes=5),
        payload_overrides: dict[str, Any] | None = None,
        signing_key: rsa.RSAPrivateKey | str | bytes | None = None,
        algorithm: str = "RS256",
    ) -> str:
        now = datetime.now(UTC)
        payload = {
            "sub": str(subject),
            "aud": "authenticated",
            "iss": "https://test-project.supabase.co/auth/v1",
            "exp": now + expires_in,
            "iat": now,
            "email": "student@example.com",
            "role": "authenticated",
            "aal": "aal1",
            "session_id": "00000000-0000-4000-8000-000000000001",
            "phone": "",
            "is_anonymous": False,
            "app_metadata": {
                "provider": first_provider,
                "providers": [first_provider],
            },
            "user_metadata": {"provider": "untrusted-client-value"},
            "amr": [
                {
                    "method": authentication_method,
                    "timestamp": int(now.timestamp()),
                }
            ],
        }
        if payload_overrides:
            payload.update(payload_overrides)
        return jwt.encode(
            payload,
            signing_key or private_key,
            algorithm=algorithm,
            headers={"kid": "test-key"},
        )

    return create_token
