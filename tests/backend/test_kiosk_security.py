from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from backend.core.clock import FrozenClock
from backend.kiosk.security import (
    AccessTokenExpired,
    AccessTokenInvalid,
    KioskAccessTokenCodec,
    KioskPasswordHasher,
    hash_opaque_token,
    hash_rate_limit_identity,
)


def test_password_verification_does_not_accept_wrong_value() -> None:
    password_hasher = KioskPasswordHasher()
    hashed = password_hasher.hash("church-kiosk-secret")

    assert password_hasher.verify(hashed, "church-kiosk-secret") is True
    assert password_hasher.verify(hashed, "wrong") is False
    assert password_hasher.verify("not-an-argon-hash", "church-kiosk-secret") is False


def test_opaque_refresh_hash_is_keyed_and_deterministic() -> None:
    token = "opaque-refresh-token"

    first = hash_opaque_token(token, "a" * 32)
    second = hash_opaque_token(token, "a" * 32)

    assert first == second
    assert token not in first
    assert first != hash_opaque_token(token, "b" * 32)


def test_rate_limit_identity_never_contains_raw_network_values() -> None:
    result = hash_rate_limit_identity(
        "203.0.113.10", "Church Tablet Browser/1.0", "c" * 32
    )

    assert result.startswith("hmac-sha256:")
    assert "203.0.113.10" not in result
    assert "Church Tablet Browser" not in result


def test_access_token_uses_injected_clock_and_exact_expiry() -> None:
    clock = FrozenClock(datetime(2026, 8, 21, 1, tzinfo=UTC))
    codec = KioskAccessTokenCodec("s" * 32, clock=clock)
    session_id = uuid4()

    token, expires_at = codec.issue(session_id)
    assert expires_at == clock.now() + timedelta(minutes=15)
    assert codec.verify(token).session_id == session_id

    clock.advance(minutes=15)
    with pytest.raises(AccessTokenExpired):
        codec.verify(token)


def test_access_token_rejects_tampering_and_wrong_type() -> None:
    clock = FrozenClock(datetime(2026, 8, 21, 1, tzinfo=UTC))
    codec = KioskAccessTokenCodec("s" * 32, clock=clock)
    token, _ = codec.issue(uuid4())

    with pytest.raises(AccessTokenInvalid):
        codec.verify(f"{token[:-1]}x")
