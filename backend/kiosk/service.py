import base64
import binascii
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from backend.core.clock import Clock, SystemClock
from backend.core.errors import ApiError
from backend.core.rate_limit import KIOSK_LOGIN_RATE_LIMIT
from backend.kiosk.repository import (
    KioskRepository,
    KioskSessionCursorKey,
    KioskSessionRecord,
    ManagedKioskSessionRecord,
)
from backend.kiosk.schemas import (
    AdminKioskSessionPage,
    AdminKioskSessionView,
    IssuedQrChallenge,
    KioskSessionListFilters,
    KioskTokens,
    QrChallenge,
)
from backend.kiosk.security import (
    AccessTokenInvalid,
    KioskAccessTokenCodec,
    KioskPasswordHasher,
    QrChallengeCodec,
    QrExpired,
    QrInvalid,
    generate_opaque_refresh_token,
    hash_opaque_token,
)

REFRESH_TOKEN_LIFETIME = timedelta(days=30)
INVALID_CURSOR = ("INVALID_CURSOR", "페이지 위치를 확인해 주세요.", 422)
KIOSK_CURSOR_VERSION = 1
KIOSK_CURSOR_FIELDS = {"v", "c", "i"}


class KioskLoginRejected(ApiError):
    def __init__(self) -> None:
        super().__init__(
            "KIOSK_LOGIN_FAILED",
            "관리자 비밀번호를 확인해 주세요.",
            401,
        )


class KioskSessionRevoked(ApiError):
    def __init__(self) -> None:
        super().__init__(
            "KIOSK_SESSION_REVOKED",
            "비치기기 로그인이 만료되었습니다. 다시 로그인해 주세요.",
            401,
        )


class QrChallengeInvalid(ApiError):
    def __init__(self) -> None:
        super().__init__(
            "QR_INVALID",
            "유효하지 않은 출결 QR 코드입니다.",
            400,
        )


class QrChallengeExpired(ApiError):
    def __init__(self) -> None:
        super().__init__(
            "QR_EXPIRED",
            "QR 코드가 만료되었습니다. 새 QR 코드를 스캔해 주세요.",
            400,
        )


class KioskSessionService:
    def __init__(
        self,
        repository: KioskRepository,
        *,
        password_hash: str,
        cookie_secret: str,
        qr_signing_secret: str,
        clock: Clock | None = None,
        password_hasher: KioskPasswordHasher | None = None,
    ) -> None:
        self.repository = repository
        self.clock = clock or SystemClock()
        self._password_hash = password_hash
        self._cookie_secret = cookie_secret
        self._password_hasher = password_hasher or KioskPasswordHasher()
        self._access_tokens = KioskAccessTokenCodec(cookie_secret, clock=self.clock)
        self._qr_challenges = QrChallengeCodec(
            qr_signing_secret,
            clock=self.clock,
        )

    async def login(self, password: str, rate_limit_key_hash: str) -> KioskTokens:
        policy = KIOSK_LOGIN_RATE_LIMIT
        now = self.clock.now()
        blocked = await self.repository.rate_limit_is_blocked(
            rate_limit_key_hash, policy.action, now
        )
        password_matches = self._password_hasher.verify(
            self._password_hash, password
        )
        if blocked:
            raise KioskLoginRejected

        if not password_matches:
            await self.repository.record_rate_limit_failure(
                rate_limit_key_hash,
                policy.action,
                now,
                window=policy.window,
                limit=policy.attempt_limit,
                block_for=policy.block_for,
            )
            raise KioskLoginRejected

        await self.repository.clear_rate_limit(rate_limit_key_hash, policy.action)
        refresh_token = generate_opaque_refresh_token()
        refresh_expires_at = now + REFRESH_TOKEN_LIFETIME
        session = await self.repository.create_session(
            hash_opaque_token(refresh_token, self._cookie_secret),
            now,
            refresh_expires_at,
        )
        return self._tokens_for(session, refresh_token)

    async def refresh(self, refresh_token: str) -> KioskTokens:
        now = self.clock.now()
        replacement_token = generate_opaque_refresh_token()
        refresh_expires_at = now + REFRESH_TOKEN_LIFETIME
        session = await self.repository.rotate_session(
            hash_opaque_token(refresh_token, self._cookie_secret),
            hash_opaque_token(replacement_token, self._cookie_secret),
            now,
            refresh_expires_at,
        )
        if session is None:
            raise KioskSessionRevoked
        return self._tokens_for(session, replacement_token)

    async def require_access(self, access_token: str) -> KioskSessionRecord:
        try:
            claims = self._access_tokens.verify(access_token)
        except AccessTokenInvalid as error:
            raise KioskSessionRevoked from error
        session = await self.repository.active_session(claims.session_id, self.clock.now())
        if session is None:
            raise KioskSessionRevoked
        return session

    async def revoke(self, access_token: str) -> None:
        try:
            claims = self._access_tokens.verify(access_token)
        except AccessTokenInvalid as error:
            raise KioskSessionRevoked from error
        if not await self.repository.revoke_session(claims.session_id, self.clock.now()):
            raise KioskSessionRevoked

    async def admin_sessions(
        self,
        filters: KioskSessionListFilters,
    ) -> AdminKioskSessionPage:
        cursor_key = self._decode_admin_cursor(filters.cursor)
        candidates = await self.repository.admin_sessions(
            page_size=filters.page_size,
            cursor_key=cursor_key,
        )
        records = candidates[: filters.page_size]
        next_cursor = None
        if len(candidates) > filters.page_size and records:
            next_cursor = self._encode_admin_cursor(records[-1])
        return AdminKioskSessionPage(
            items=[AdminKioskSessionView.model_validate(record) for record in records],
            next_cursor=next_cursor,
            page_size=filters.page_size,
        )

    @staticmethod
    def _canonical_cursor_timestamp(value: datetime) -> str:
        return value.astimezone(UTC).isoformat(timespec="microseconds").replace(
            "+00:00", "Z"
        )

    @classmethod
    def _encode_admin_cursor(cls, session: ManagedKioskSessionRecord) -> str:
        payload = {
            "v": KIOSK_CURSOR_VERSION,
            "c": cls._canonical_cursor_timestamp(session.created_at),
            "i": str(session.session_id),
        }
        raw = json.dumps(
            payload,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    @classmethod
    def _decode_admin_cursor(cls, cursor: str | None) -> KioskSessionCursorKey | None:
        if cursor is None:
            return None
        try:
            padding = "=" * (-len(cursor) % 4)
            raw = base64.b64decode(cursor + padding, altchars=b"-_", validate=True)
            canonical_encoding = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
            if canonical_encoding != cursor or len(raw) > 512:
                raise ValueError("cursor encoding is invalid")
            payload: Any = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict) or set(payload) != KIOSK_CURSOR_FIELDS:
                raise ValueError("cursor shape is invalid")

            version = payload["v"]
            timestamp_text = payload["c"]
            session_id_text = payload["i"]
            if (
                type(version) is not int
                or version != KIOSK_CURSOR_VERSION
                or not isinstance(timestamp_text, str)
                or not isinstance(session_id_text, str)
            ):
                raise ValueError("cursor fields are invalid")

            timestamp = datetime.fromisoformat(timestamp_text)
            if (
                timestamp.tzinfo is None
                or cls._canonical_cursor_timestamp(timestamp) != timestamp_text
            ):
                raise ValueError("cursor timestamp is not canonical")
            session_id = UUID(session_id_text)
            if str(session_id) != session_id_text:
                raise ValueError("cursor id is not canonical")
            return KioskSessionCursorKey(
                created_at=timestamp,
                session_id=session_id,
            )
        except (
            binascii.Error,
            json.JSONDecodeError,
            OverflowError,
            UnicodeDecodeError,
            TypeError,
            ValueError,
        ):
            raise ApiError(*INVALID_CURSOR) from None

    async def revoke_as_admin(self, session_id: UUID, actor_id: UUID) -> None:
        if not await self.repository.revoke_session_as_admin(
            session_id,
            actor_id=actor_id,
            now=self.clock.now(),
        ):
            raise ApiError(
                "KIOSK_SESSION_NOT_FOUND",
                "기기 세션을 찾을 수 없습니다.",
                404,
            )

    def issue_qr_challenge(self, kiosk_session_id: UUID) -> IssuedQrChallenge:
        token = self._qr_challenges.issue(kiosk_session_id)
        return IssuedQrChallenge(
            token=token,
            challenge=self._qr_challenges.verify(token),
        )

    async def verify_qr_challenge(self, token: str) -> QrChallenge:
        try:
            challenge = self._qr_challenges.verify(token)
        except QrExpired as error:
            raise QrChallengeExpired from error
        except QrInvalid as error:
            raise QrChallengeInvalid from error
        session = await self.repository.active_session(
            challenge.kiosk_session_id,
            self.clock.now(),
        )
        if session is None:
            raise KioskSessionRevoked
        return challenge

    def _tokens_for(
        self, session: KioskSessionRecord, refresh_token: str
    ) -> KioskTokens:
        access_token, access_expires_at = self._access_tokens.issue(session.id)
        return KioskTokens(
            session_id=session.id,
            access_token=access_token,
            access_expires_at=access_expires_at,
            refresh_token=refresh_token,
            refresh_expires_at=session.refresh_expires_at,
        )
