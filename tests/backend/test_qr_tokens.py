from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import jwt
import pytest

from backend.core.clock import FrozenClock
from backend.kiosk.repository import KioskSessionRecord
from backend.kiosk.security import (
    QR_LIFETIME,
    QrChallengeCodec,
    QrExpired,
    QrInvalid,
)
from backend.kiosk.service import (
    KioskSessionRevoked,
    KioskSessionService,
    QrChallengeExpired,
    QrChallengeInvalid,
)

QR_SECRET = "q" * 64
COOKIE_SECRET = "c" * 32


@pytest.fixture
def frozen_clock() -> FrozenClock:
    return FrozenClock(datetime(2026, 8, 21, 1, 2, 3, 456789, tzinfo=UTC))


@pytest.fixture
def kiosk_id() -> UUID:
    return uuid4()


@pytest.fixture
def qr_codec(frozen_clock: FrozenClock) -> QrChallengeCodec:
    return QrChallengeCodec(QR_SECRET, clock=frozen_clock)


def test_qr_is_valid_before_twenty_seconds(
    qr_codec: QrChallengeCodec,
    frozen_clock: FrozenClock,
    kiosk_id: UUID,
) -> None:
    token = qr_codec.issue(kiosk_id)

    frozen_clock.advance(seconds=19, milliseconds=999)

    assert qr_codec.verify(token).kiosk_session_id == kiosk_id


def test_qr_expires_at_twenty_seconds(
    qr_codec: QrChallengeCodec,
    frozen_clock: FrozenClock,
    kiosk_id: UUID,
) -> None:
    token = qr_codec.issue(kiosk_id)

    frozen_clock.advance(seconds=20)

    with pytest.raises(QrExpired):
        qr_codec.verify(token)


def test_qr_claims_and_response_times_preserve_full_subsecond_lifetime(
    qr_codec: QrChallengeCodec,
    frozen_clock: FrozenClock,
    kiosk_id: UUID,
) -> None:
    issued_at = frozen_clock.now()

    token = qr_codec.issue(kiosk_id)
    challenge = qr_codec.verify(token)
    claims = jwt.decode(token, options={"verify_signature": False})

    assert challenge.issued_at == issued_at
    assert challenge.expires_at == issued_at + QR_LIFETIME
    assert challenge.expires_at - challenge.issued_at == timedelta(seconds=20)
    assert claims["typ"] == "attendance-qr"
    assert UUID(claims["sid"]) == kiosk_id
    assert UUID(claims["jti"]) == challenge.nonce
    assert datetime.fromtimestamp(claims["iat"], tz=UTC) == challenge.issued_at
    assert datetime.fromtimestamp(claims["exp"], tz=UTC) == challenge.expires_at


def test_qr_nonce_changes_for_every_issue(
    qr_codec: QrChallengeCodec,
    kiosk_id: UUID,
) -> None:
    first = qr_codec.verify(qr_codec.issue(kiosk_id))
    second = qr_codec.verify(qr_codec.issue(kiosk_id))

    assert first.nonce != second.nonce


def test_qr_rejects_signature_tampering(
    qr_codec: QrChallengeCodec,
    kiosk_id: UUID,
) -> None:
    token = qr_codec.issue(kiosk_id)
    header, payload, signature = token.split(".")
    changed_first_character = "A" if signature[0] != "A" else "B"
    tampered = ".".join(
        (header, payload, f"{changed_first_character}{signature[1:]}")
    )

    with pytest.raises(QrInvalid):
        qr_codec.verify(tampered)


def test_qr_rejects_different_secret(
    qr_codec: QrChallengeCodec,
    frozen_clock: FrozenClock,
    kiosk_id: UUID,
) -> None:
    token = qr_codec.issue(kiosk_id)
    other_codec = QrChallengeCodec("x" * 32, clock=frozen_clock)

    with pytest.raises(QrInvalid):
        other_codec.verify(token)


@pytest.mark.parametrize(
    ("claim", "value"),
    [
        ("typ", "kiosk-access"),
        ("sid", "not-a-uuid"),
        ("jti", "not-a-uuid"),
        ("iat", "1787274123.5"),
        ("iat", True),
        ("exp", "1787274143.5"),
        ("exp", False),
    ],
)
def test_qr_rejects_wrong_type_or_invalid_claims(
    qr_codec: QrChallengeCodec,
    kiosk_id: UUID,
    claim: str,
    value: object,
) -> None:
    token = qr_codec.issue(kiosk_id)
    claims = jwt.decode(token, options={"verify_signature": False})
    claims[claim] = value

    malformed = jwt.encode(claims, QR_SECRET, algorithm="HS256")

    with pytest.raises(QrInvalid):
        qr_codec.verify(malformed)


@pytest.mark.parametrize("missing_claim", ["typ", "sid", "iat", "exp", "jti"])
def test_qr_requires_every_claim(
    qr_codec: QrChallengeCodec,
    kiosk_id: UUID,
    missing_claim: str,
) -> None:
    token = qr_codec.issue(kiosk_id)
    claims = jwt.decode(token, options={"verify_signature": False})
    del claims[missing_claim]

    incomplete = jwt.encode(claims, QR_SECRET, algorithm="HS256")

    with pytest.raises(QrInvalid):
        qr_codec.verify(incomplete)


def test_qr_accepts_only_hs256(
    qr_codec: QrChallengeCodec,
    kiosk_id: UUID,
) -> None:
    token = qr_codec.issue(kiosk_id)
    claims = jwt.decode(token, options={"verify_signature": False})
    wrong_algorithm = jwt.encode(claims, QR_SECRET, algorithm="HS384")

    with pytest.raises(QrInvalid):
        qr_codec.verify(wrong_algorithm)


def test_qr_rejects_unexpected_claims(
    qr_codec: QrChallengeCodec,
    kiosk_id: UUID,
) -> None:
    token = qr_codec.issue(kiosk_id)
    claims = jwt.decode(token, options={"verify_signature": False})
    claims["student_id"] = str(uuid4())
    token_with_personal_data = jwt.encode(claims, QR_SECRET, algorithm="HS256")

    with pytest.raises(QrInvalid):
        qr_codec.verify(token_with_personal_data)


@pytest.mark.parametrize(
    ("issued_offset", "expiry_offset"),
    [
        (timedelta(seconds=1), timedelta(seconds=21)),
        (timedelta(), timedelta()),
        (timedelta(), timedelta(seconds=-1)),
        (timedelta(), timedelta(seconds=19, milliseconds=999)),
        (timedelta(), timedelta(seconds=21)),
    ],
)
def test_qr_rejects_future_or_non_twenty_second_times(
    qr_codec: QrChallengeCodec,
    frozen_clock: FrozenClock,
    kiosk_id: UUID,
    issued_offset: timedelta,
    expiry_offset: timedelta,
) -> None:
    now = frozen_clock.now()
    claims: dict[str, Any] = {
        "typ": "attendance-qr",
        "sid": str(kiosk_id),
        "iat": (now + issued_offset).timestamp(),
        "exp": (now + expiry_offset).timestamp(),
        "jti": str(uuid4()),
    }
    malformed = jwt.encode(claims, QR_SECRET, algorithm="HS256")

    with pytest.raises(QrInvalid):
        qr_codec.verify(malformed)


class SessionStateRepository:
    def __init__(self, session: KioskSessionRecord) -> None:
        self.session = session

    async def active_session(
        self, session_id: UUID, now: datetime
    ) -> KioskSessionRecord | None:
        if (
            self.session.id != session_id
            or self.session.revoked_at is not None
            or self.session.refresh_expires_at <= now
        ):
            return None
        return self.session


def _kiosk_service(
    repository: SessionStateRepository,
    clock: FrozenClock,
) -> KioskSessionService:
    return KioskSessionService(
        repository,  # type: ignore[arg-type]
        password_hash="unused-in-qr-tests",
        cookie_secret=COOKIE_SECRET,
        qr_signing_secret=QR_SECRET,
        clock=clock,
    )


@pytest.fixture
def kiosk_record(frozen_clock: FrozenClock, kiosk_id: UUID) -> KioskSessionRecord:
    return KioskSessionRecord(
        id=kiosk_id,
        created_at=frozen_clock.now(),
        last_seen_at=frozen_clock.now(),
        refresh_expires_at=frozen_clock.now() + timedelta(days=30),
        revoked_at=None,
    )


async def test_qr_service_rechecks_durable_session_on_verification(
    frozen_clock: FrozenClock,
    kiosk_record: KioskSessionRecord,
) -> None:
    repository = SessionStateRepository(kiosk_record)
    service = _kiosk_service(repository, frozen_clock)
    issued = service.issue_qr_challenge(kiosk_record.id)

    assert (
        await service.verify_qr_challenge(issued.token)
    ).kiosk_session_id == kiosk_record.id

    repository.session = replace(kiosk_record, revoked_at=frozen_clock.now())
    with pytest.raises(KioskSessionRevoked):
        await service.verify_qr_challenge(issued.token)


async def test_qr_service_rejects_refresh_expired_session_before_qr_expiry(
    frozen_clock: FrozenClock,
    kiosk_record: KioskSessionRecord,
) -> None:
    expiring_record = replace(
        kiosk_record,
        refresh_expires_at=frozen_clock.now() + timedelta(seconds=10),
    )
    repository = SessionStateRepository(expiring_record)
    service = _kiosk_service(repository, frozen_clock)
    issued = service.issue_qr_challenge(kiosk_record.id)

    frozen_clock.advance(seconds=10)

    with pytest.raises(KioskSessionRevoked):
        await service.verify_qr_challenge(issued.token)


async def test_qr_service_maps_invalid_and_expired_tokens_to_safe_errors(
    frozen_clock: FrozenClock,
    kiosk_record: KioskSessionRecord,
) -> None:
    service = _kiosk_service(SessionStateRepository(kiosk_record), frozen_clock)

    with pytest.raises(QrChallengeInvalid) as invalid:
        await service.verify_qr_challenge("not-a-jwt")
    assert invalid.value.code == "QR_INVALID"

    issued = service.issue_qr_challenge(kiosk_record.id)
    frozen_clock.advance(seconds=20)
    with pytest.raises(QrChallengeExpired) as expired:
        await service.verify_qr_challenge(issued.token)
    assert expired.value.code == "QR_EXPIRED"
