import hashlib
import hmac
import math
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from jwt import InvalidTokenError

from backend.core.clock import Clock, SystemClock
from backend.kiosk.schemas import QrChallenge

ACCESS_TOKEN_LIFETIME = timedelta(minutes=15)
QR_LIFETIME = timedelta(seconds=20)
REFRESH_TOKEN_BYTES = 32
ACCESS_TOKEN_TYPE = "kiosk-access"
QR_TOKEN_TYPE = "attendance-qr"
QR_REQUIRED_CLAIMS = frozenset({"typ", "sid", "iat", "exp", "jti"})


class AccessTokenInvalid(Exception):
    pass


class AccessTokenExpired(AccessTokenInvalid):
    pass


class QrInvalid(Exception):
    pass


class QrExpired(QrInvalid):
    pass


@dataclass(frozen=True)
class AccessTokenClaims:
    session_id: UUID
    issued_at: datetime
    expires_at: datetime


class KioskPasswordHasher:
    def __init__(self, hasher: PasswordHasher | None = None) -> None:
        self._hasher = hasher or PasswordHasher()

    def hash(self, password: str) -> str:
        return self._hasher.hash(password)

    def verify(self, hashed_password: str, password: str) -> bool:
        try:
            return self._hasher.verify(hashed_password, password)
        except (VerificationError, InvalidHashError):
            return False


def generate_opaque_refresh_token() -> str:
    return secrets.token_urlsafe(REFRESH_TOKEN_BYTES)


def hash_opaque_token(token: str, pepper: str) -> str:
    return hmac.new(
        pepper.encode("utf-8"), token.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def hash_rate_limit_identity(ip_address: str, user_agent: str, secret: str) -> str:
    identity = f"kiosk-login\0{ip_address}\0{user_agent}".encode()
    digest = hmac.new(secret.encode(), identity, hashlib.sha256).hexdigest()
    return f"hmac-sha256:{digest}"


class KioskAccessTokenCodec:
    def __init__(self, secret: str, *, clock: Clock | None = None) -> None:
        self._secret = secret
        self._clock = clock or SystemClock()

    def issue(self, session_id: UUID) -> tuple[str, datetime]:
        issued_at = self._clock.now().replace(microsecond=0)
        expires_at = issued_at + ACCESS_TOKEN_LIFETIME
        payload = {
            "typ": ACCESS_TOKEN_TYPE,
            "sid": str(session_id),
            "iat": int(issued_at.timestamp()),
            "exp": int(expires_at.timestamp()),
        }
        return (
            jwt.encode(payload, self._secret, algorithm="HS256"),
            expires_at,
        )

    def verify(self, token: str) -> AccessTokenClaims:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=["HS256"],
                options={
                    "require": ["typ", "sid", "iat", "exp"],
                    "verify_exp": False,
                    "verify_iat": False,
                    "verify_nbf": False,
                },
            )
            issued_timestamp = self._required_integer(payload, "iat")
            expires_timestamp = self._required_integer(payload, "exp")
            if payload.get("typ") != ACCESS_TOKEN_TYPE:
                raise AccessTokenInvalid
            session_id = UUID(str(payload["sid"]))
            issued_at = datetime.fromtimestamp(issued_timestamp, tz=self._clock.now().tzinfo)
            expires_at = datetime.fromtimestamp(expires_timestamp, tz=self._clock.now().tzinfo)
        except AccessTokenInvalid:
            raise
        except (InvalidTokenError, KeyError, TypeError, ValueError, OverflowError) as error:
            raise AccessTokenInvalid from error

        now = self._clock.now()
        if expires_at <= issued_at or issued_at > now:
            raise AccessTokenInvalid
        if now >= expires_at:
            raise AccessTokenExpired
        return AccessTokenClaims(
            session_id=session_id,
            issued_at=issued_at,
            expires_at=expires_at,
        )

    @staticmethod
    def _required_integer(payload: dict[str, object], claim: str) -> int:
        value = payload[claim]
        if isinstance(value, bool) or not isinstance(value, int):
            raise AccessTokenInvalid
        return value


class QrChallengeCodec:
    def __init__(self, secret: str, *, clock: Clock | None = None) -> None:
        self._secret = secret
        self._clock = clock or SystemClock()

    def issue(self, kiosk_session_id: UUID) -> str:
        issued_at = self._clock.now().astimezone(UTC)
        expires_at = issued_at + QR_LIFETIME
        payload = {
            "typ": QR_TOKEN_TYPE,
            "sid": str(kiosk_session_id),
            # JWT NumericDate permits non-integer values. Preserving the fraction
            # prevents a sub-second issue time from losing part of the 20 seconds.
            "iat": issued_at.timestamp(),
            "exp": expires_at.timestamp(),
            "jti": str(uuid4()),
        }
        return jwt.encode(payload, self._secret, algorithm="HS256")

    def verify(self, token: str) -> QrChallenge:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=["HS256"],
                options={
                    "require": sorted(QR_REQUIRED_CLAIMS),
                    "verify_exp": False,
                    "verify_iat": False,
                    "verify_nbf": False,
                },
            )
            if set(payload) != QR_REQUIRED_CLAIMS:
                raise QrInvalid
            if payload.get("typ") != QR_TOKEN_TYPE:
                raise QrInvalid
            issued_at = self._required_timestamp(payload, "iat")
            expires_at = self._required_timestamp(payload, "exp")
            kiosk_session_id = UUID(str(payload["sid"]))
            nonce = UUID(str(payload["jti"]))
        except QrInvalid:
            raise
        except (InvalidTokenError, KeyError, TypeError, ValueError, OverflowError) as error:
            raise QrInvalid from error

        now = self._clock.now().astimezone(UTC)
        if issued_at > now or expires_at - issued_at != QR_LIFETIME:
            raise QrInvalid
        if now >= expires_at:
            raise QrExpired
        return QrChallenge(
            kiosk_session_id=kiosk_session_id,
            issued_at=issued_at,
            expires_at=expires_at,
            nonce=nonce,
        )

    @staticmethod
    def _required_timestamp(payload: dict[str, object], claim: str) -> datetime:
        value = payload[claim]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise QrInvalid
        timestamp = float(value)
        if not math.isfinite(timestamp):
            raise QrInvalid
        return datetime.fromtimestamp(timestamp, tz=UTC)
