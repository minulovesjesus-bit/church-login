from datetime import timedelta

from backend.core.clock import Clock, SystemClock
from backend.core.errors import ApiError
from backend.core.rate_limit import KIOSK_LOGIN_RATE_LIMIT
from backend.kiosk.repository import KioskRepository, KioskSessionRecord
from backend.kiosk.schemas import KioskTokens
from backend.kiosk.security import (
    AccessTokenInvalid,
    KioskAccessTokenCodec,
    KioskPasswordHasher,
    generate_opaque_refresh_token,
    hash_opaque_token,
)

REFRESH_TOKEN_LIFETIME = timedelta(days=30)


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


class KioskSessionService:
    def __init__(
        self,
        repository: KioskRepository,
        *,
        password_hash: str,
        cookie_secret: str,
        clock: Clock | None = None,
        password_hasher: KioskPasswordHasher | None = None,
    ) -> None:
        self.repository = repository
        self.clock = clock or SystemClock()
        self._password_hash = password_hash
        self._cookie_secret = cookie_secret
        self._password_hasher = password_hasher or KioskPasswordHasher()
        self._access_tokens = KioskAccessTokenCodec(cookie_secret, clock=self.clock)

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
