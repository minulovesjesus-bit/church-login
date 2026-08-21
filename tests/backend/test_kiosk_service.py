import asyncio
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import psycopg
import pytest

from backend.core.clock import FrozenClock
from backend.core.config import settings
from backend.kiosk.repository import KioskRepository, KioskSessionRecord
from backend.kiosk.schemas import KioskTokens
from backend.kiosk.security import KioskPasswordHasher, hash_opaque_token
from backend.kiosk.service import (
    KioskLoginRejected,
    KioskSessionRevoked,
    KioskSessionService,
)


class InMemoryKioskRepository:
    def __init__(self) -> None:
        self.sessions: dict[UUID, KioskSessionRecord] = {}
        self.failures: dict[str, int] = {}
        self.blocked: set[str] = set()
        self.saved_refresh_hashes: list[str] = []

    async def rate_limit_is_blocked(self, key_hash: str, action: str, now: datetime) -> bool:
        return key_hash in self.blocked

    async def record_rate_limit_failure(
        self,
        key_hash: str,
        action: str,
        now: datetime,
        *,
        window: timedelta,
        limit: int,
        block_for: timedelta,
    ) -> bool:
        count = self.failures.get(key_hash, 0) + 1
        self.failures[key_hash] = count
        if count >= limit:
            self.blocked.add(key_hash)
        return key_hash in self.blocked

    async def clear_rate_limit(self, key_hash: str, action: str) -> None:
        self.failures.pop(key_hash, None)
        self.blocked.discard(key_hash)

    async def create_session(
        self, refresh_token_hash: str, now: datetime, refresh_expires_at: datetime
    ) -> KioskSessionRecord:
        record = KioskSessionRecord(
            id=uuid4(),
            created_at=now,
            last_seen_at=now,
            refresh_expires_at=refresh_expires_at,
            revoked_at=None,
        )
        self.sessions[record.id] = record
        self.saved_refresh_hashes.append(refresh_token_hash)
        return record

    async def rotate_session(
        self,
        old_refresh_token_hash: str,
        new_refresh_token_hash: str,
        now: datetime,
        refresh_expires_at: datetime,
    ) -> KioskSessionRecord | None:
        if old_refresh_token_hash not in self.saved_refresh_hashes:
            return None
        index = self.saved_refresh_hashes.index(old_refresh_token_hash)
        session = list(self.sessions.values())[index]
        if session.revoked_at is not None or session.refresh_expires_at <= now:
            return None
        self.saved_refresh_hashes[index] = new_refresh_token_hash
        replacement = KioskSessionRecord(
            id=session.id,
            created_at=session.created_at,
            last_seen_at=now,
            refresh_expires_at=refresh_expires_at,
            revoked_at=None,
        )
        self.sessions[session.id] = replacement
        return replacement

    async def active_session(self, session_id: UUID, now: datetime) -> KioskSessionRecord | None:
        session = self.sessions.get(session_id)
        if (
            session is None
            or session.revoked_at is not None
            or session.refresh_expires_at <= now
        ):
            return None
        return session

    async def revoke_session(self, session_id: UUID, now: datetime) -> bool:
        session = self.sessions.get(session_id)
        if session is None or session.revoked_at is not None:
            return False
        self.sessions[session_id] = KioskSessionRecord(
            id=session.id,
            created_at=session.created_at,
            last_seen_at=session.last_seen_at,
            refresh_expires_at=session.refresh_expires_at,
            revoked_at=now,
        )
        return True


class RecordingPasswordHasher:
    def __init__(self, result: bool) -> None:
        self.result = result
        self.calls: list[tuple[str, str]] = []

    def verify(self, hashed_password: str, password: str) -> bool:
        self.calls.append((hashed_password, password))
        return self.result


@pytest.fixture
def frozen_clock() -> FrozenClock:
    return FrozenClock(datetime(2026, 8, 21, 1, tzinfo=UTC))


@pytest.fixture
def kiosk_password_hash() -> str:
    return KioskPasswordHasher().hash("church-kiosk-secret")


@pytest.fixture
def kiosk_service(
    frozen_clock: FrozenClock, kiosk_password_hash: str
) -> KioskSessionService:
    return KioskSessionService(
        InMemoryKioskRepository(),
        password_hash=kiosk_password_hash,
        cookie_secret="k" * 32,
        clock=frozen_clock,
    )


async def test_refresh_rotation_invalidates_previous_token(
    kiosk_service: KioskSessionService,
) -> None:
    kiosk_session = await kiosk_service.login(
        "church-kiosk-secret", "hmac-sha256:client"
    )
    first = kiosk_session.refresh_token

    second = await kiosk_service.refresh(first)

    with pytest.raises(KioskSessionRevoked):
        await kiosk_service.refresh(first)
    assert second.refresh_token != first
    assert second.refresh_expires_at == kiosk_service.clock.now() + timedelta(days=30)


async def test_wrong_password_and_blocked_client_use_same_safe_error(
    kiosk_service: KioskSessionService,
) -> None:
    with pytest.raises(KioskLoginRejected) as wrong:
        await kiosk_service.login("wrong", "hmac-sha256:client")

    repository = kiosk_service.repository
    repository.blocked.add("hmac-sha256:blocked")
    with pytest.raises(KioskLoginRejected) as blocked:
        await kiosk_service.login("church-kiosk-secret", "hmac-sha256:blocked")

    assert wrong.value.code == blocked.value.code == "KIOSK_LOGIN_FAILED"
    assert wrong.value.message == blocked.value.message


async def test_blocked_and_wrong_password_both_perform_password_verification(
    frozen_clock: FrozenClock,
) -> None:
    wrong_repository = InMemoryKioskRepository()
    wrong_hasher = RecordingPasswordHasher(result=False)
    wrong_service = KioskSessionService(
        wrong_repository,
        password_hash="stored-argon-hash",
        cookie_secret="k" * 32,
        clock=frozen_clock,
        password_hasher=wrong_hasher,
    )
    with pytest.raises(KioskLoginRejected):
        await wrong_service.login("wrong", "hmac-sha256:wrong")

    blocked_repository = InMemoryKioskRepository()
    blocked_repository.blocked.add("hmac-sha256:blocked")
    blocked_repository.failures["hmac-sha256:blocked"] = 5
    blocked_hasher = RecordingPasswordHasher(result=True)
    blocked_service = KioskSessionService(
        blocked_repository,
        password_hash="stored-argon-hash",
        cookie_secret="k" * 32,
        clock=frozen_clock,
        password_hasher=blocked_hasher,
    )
    with pytest.raises(KioskLoginRejected):
        await blocked_service.login("correct", "hmac-sha256:blocked")

    assert wrong_hasher.calls == [("stored-argon-hash", "wrong")]
    assert blocked_hasher.calls == [("stored-argon-hash", "correct")]
    assert blocked_repository.failures["hmac-sha256:blocked"] == 5


async def test_successful_login_clears_rate_limit_and_persists_only_hash(
    kiosk_service: KioskSessionService,
) -> None:
    repository = kiosk_service.repository
    repository.failures["hmac-sha256:client"] = 2

    tokens = await kiosk_service.login("church-kiosk-secret", "hmac-sha256:client")

    assert "hmac-sha256:client" not in repository.failures
    assert tokens.refresh_token not in repository.saved_refresh_hashes
    assert len(repository.saved_refresh_hashes[0]) == 64


async def test_access_validation_rechecks_durable_session_state(
    kiosk_service: KioskSessionService,
) -> None:
    tokens = await kiosk_service.login("church-kiosk-secret", "hmac-sha256:client")
    session = await kiosk_service.require_access(tokens.access_token)
    assert session.id == tokens.session_id

    await kiosk_service.revoke(tokens.access_token)

    with pytest.raises(KioskSessionRevoked):
        await kiosk_service.require_access(tokens.access_token)


async def test_refresh_expiry_is_rejected(
    kiosk_service: KioskSessionService, frozen_clock: FrozenClock
) -> None:
    tokens = await kiosk_service.login("church-kiosk-secret", "hmac-sha256:client")
    frozen_clock.advance(days=30)

    with pytest.raises(KioskSessionRevoked):
        await kiosk_service.refresh(tokens.refresh_token)


async def test_postgres_rate_limit_rotation_replay_and_revocation() -> None:
    database_url = settings.database_url
    if not database_url or urlsplit(database_url).hostname not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        pytest.skip("A loopback DATABASE_URL is required for the live kiosk test")

    connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        await connection.execute("set local role app_backend")
        repository = KioskRepository(connection)
        clock = FrozenClock(datetime(2026, 8, 21, 1, tzinfo=UTC))
        service = KioskSessionService(
            repository,
            password_hash=KioskPasswordHasher().hash("church-kiosk-secret"),
            cookie_secret="p" * 32,
            clock=clock,
        )
        rate_key = f"hmac-sha256:{uuid4().hex}"

        with pytest.raises(KioskLoginRejected):
            await service.login("wrong", rate_key)
        bucket = await connection.execute(
            """
            select bucket_key_hash, action, attempt_count
            from app.rate_limit_buckets
            where bucket_key_hash = %s
            """,
            (rate_key,),
        )
        assert await bucket.fetchone() == (rate_key, "kiosk.login", 1)

        for _ in range(4):
            with pytest.raises(KioskLoginRejected):
                await service.login("wrong", rate_key)
        blocked_bucket = await connection.execute(
            """
            select attempt_count, blocked_until > %s
            from app.rate_limit_buckets
            where bucket_key_hash = %s
            """,
            (clock.now(), rate_key),
        )
        assert await blocked_bucket.fetchone() == (5, True)
        with pytest.raises(KioskLoginRejected) as blocked:
            await service.login("church-kiosk-secret", rate_key)
        assert blocked.value.message == "관리자 비밀번호를 확인해 주세요."

        tokens = await service.login(
            "church-kiosk-secret", f"hmac-sha256:{uuid4().hex}"
        )
        stored = await connection.execute(
            """
            select refresh_token_hash
            from app.kiosk_sessions
            where id = %s
            """,
            (tokens.session_id,),
        )
        stored_hash = (await stored.fetchone())[0]
        assert stored_hash != tokens.refresh_token
        assert len(stored_hash) == 64

        rotated = await service.refresh(tokens.refresh_token)
        assert rotated.session_id == tokens.session_id
        assert rotated.refresh_expires_at == clock.now() + timedelta(days=30)
        with pytest.raises(KioskSessionRevoked):
            await service.refresh(tokens.refresh_token)

        await service.revoke(rotated.access_token)
        with pytest.raises(KioskSessionRevoked):
            await service.require_access(rotated.access_token)
    finally:
        await connection.rollback()
        await connection.close()


async def test_postgres_concurrent_refresh_allows_exactly_one_rotation() -> None:
    database_url = settings.database_url
    if not database_url or urlsplit(database_url).hostname not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        pytest.skip("A loopback DATABASE_URL is required for the refresh race test")

    clock = FrozenClock(datetime(2026, 8, 21, 1, tzinfo=UTC))
    cookie_secret = "r" * 32
    password_hash = KioskPasswordHasher().hash("church-kiosk-secret")
    initial_connection = await psycopg.AsyncConnection.connect(database_url)
    try:
        await initial_connection.execute("set local role app_backend")
        initial_service = KioskSessionService(
            KioskRepository(initial_connection),
            password_hash=password_hash,
            cookie_secret=cookie_secret,
            clock=clock,
        )
        initial = await initial_service.login(
            "church-kiosk-secret", f"hmac-sha256:{uuid4().hex}"
        )
        await initial_connection.commit()
    finally:
        await initial_connection.close()

    barrier = asyncio.Barrier(2)

    async def rotate_once() -> KioskTokens | KioskSessionRevoked:
        connection = await psycopg.AsyncConnection.connect(database_url)
        try:
            await connection.execute("set local role app_backend")
            service = KioskSessionService(
                KioskRepository(connection),
                password_hash=password_hash,
                cookie_secret=cookie_secret,
                clock=clock,
            )
            await barrier.wait()
            try:
                replacement = await service.refresh(initial.refresh_token)
            except KioskSessionRevoked as error:
                await connection.rollback()
                return error
            await connection.commit()
            return replacement
        finally:
            await connection.close()

    try:
        results = await asyncio.wait_for(
            asyncio.gather(rotate_once(), rotate_once()), timeout=10
        )
        successes = [result for result in results if isinstance(result, KioskTokens)]
        rejections = [
            result for result in results if isinstance(result, KioskSessionRevoked)
        ]
        assert len(successes) == 1
        assert len(rejections) == 1
        winner = successes[0]
        assert winner.session_id == initial.session_id

        verification_connection = await psycopg.AsyncConnection.connect(database_url)
        try:
            await verification_connection.execute("set local role app_backend")
            stored = await verification_connection.execute(
                """
                select refresh_token_hash
                from app.kiosk_sessions
                where id = %s
                """,
                (initial.session_id,),
            )
            assert (await stored.fetchone())[0] == hash_opaque_token(
                winner.refresh_token, cookie_secret
            )
        finally:
            await verification_connection.rollback()
            await verification_connection.close()
    finally:
        cleanup_connection = await psycopg.AsyncConnection.connect(database_url)
        try:
            await cleanup_connection.execute("set local role app_backend")
            await cleanup_connection.execute(
                "delete from app.kiosk_sessions where id = %s",
                (initial.session_id,),
            )
            await cleanup_connection.commit()
        finally:
            await cleanup_connection.close()
