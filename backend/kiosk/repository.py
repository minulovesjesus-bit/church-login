from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb


@dataclass(frozen=True)
class KioskSessionRecord:
    id: UUID
    created_at: datetime
    last_seen_at: datetime
    refresh_expires_at: datetime
    revoked_at: datetime | None


@dataclass(frozen=True)
class ManagedKioskSessionRecord:
    session_id: UUID
    created_at: datetime
    last_seen_at: datetime
    refresh_expires_at: datetime
    revoked_at: datetime | None


@dataclass(frozen=True)
class KioskSessionCursorKey:
    created_at: datetime
    session_id: UUID


class KioskRepository:
    def __init__(self, connection: Any) -> None:
        self._connection = connection

    async def create_session(
        self,
        refresh_token_hash: str,
        now: datetime,
        refresh_expires_at: datetime,
    ) -> KioskSessionRecord:
        cursor = await self._connection.execute(
            """
            insert into app.kiosk_sessions (
              refresh_token_hash, created_at, last_seen_at, refresh_expires_at
            ) values (%s, %s, %s, %s)
            returning id, created_at, last_seen_at, refresh_expires_at, revoked_at
            """,
            (refresh_token_hash, now, now, refresh_expires_at),
        )
        row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("Kiosk session insert returned no row")
        return KioskSessionRecord(*row)

    async def rotate_session(
        self,
        old_refresh_token_hash: str,
        new_refresh_token_hash: str,
        now: datetime,
        refresh_expires_at: datetime,
    ) -> KioskSessionRecord | None:
        cursor = await self._connection.execute(
            """
            update app.kiosk_sessions
            set refresh_token_hash = %s,
                last_seen_at = %s,
                refresh_expires_at = %s
            where refresh_token_hash = %s
              and revoked_at is null
              and refresh_expires_at > %s
            returning id, created_at, last_seen_at, refresh_expires_at, revoked_at
            """,
            (
                new_refresh_token_hash,
                now,
                refresh_expires_at,
                old_refresh_token_hash,
                now,
            ),
        )
        row = await cursor.fetchone()
        return KioskSessionRecord(*row) if row is not None else None

    async def active_session(
        self, session_id: UUID, now: datetime
    ) -> KioskSessionRecord | None:
        cursor = await self._connection.execute(
            """
            select id, created_at, last_seen_at, refresh_expires_at, revoked_at
            from app.kiosk_sessions
            where id = %s
              and revoked_at is null
              and refresh_expires_at > %s
            """,
            (session_id, now),
        )
        row = await cursor.fetchone()
        return KioskSessionRecord(*row) if row is not None else None

    async def revoke_session(self, session_id: UUID, now: datetime) -> bool:
        cursor = await self._connection.execute(
            """
            update app.kiosk_sessions
            set revoked_at = %s, last_seen_at = %s
            where id = %s and revoked_at is null
            returning id
            """,
            (now, now, session_id),
        )
        return await cursor.fetchone() is not None

    async def admin_sessions(
        self,
        *,
        page_size: int,
        cursor_key: KioskSessionCursorKey | None,
    ) -> list[ManagedKioskSessionRecord]:
        cursor = await self._connection.execute(
            """
            select id, created_at, last_seen_at, refresh_expires_at, revoked_at
            from app.kiosk_sessions
            where (
              %(cursor_created_at)s::timestamptz is null
              or (created_at, id)
                 < (%(cursor_created_at)s::timestamptz, %(cursor_session_id)s::uuid)
            )
            order by created_at desc, id desc
            limit %(limit)s
            """,
            {
                "cursor_created_at": cursor_key.created_at if cursor_key else None,
                "cursor_session_id": str(cursor_key.session_id) if cursor_key else None,
                "limit": page_size + 1,
            },
        )
        return [ManagedKioskSessionRecord(*row) for row in await cursor.fetchall()]

    async def revoke_session_as_admin(
        self,
        session_id: UUID,
        *,
        actor_id: UUID,
        now: datetime,
    ) -> bool:
        locked = await self._connection.execute(
            """
            select revoked_at
            from app.kiosk_sessions
            where id = %s
            for update
            """,
            (session_id,),
        )
        existing = await locked.fetchone()
        if existing is None:
            return False
        if existing[0] is not None:
            return True

        cursor = await self._connection.execute(
            """
            with revoked as (
              update app.kiosk_sessions
              set revoked_at = %(now)s,
                  revoked_by = %(actor_id)s
              where id = %(session_id)s and revoked_at is null
              returning id
            ), audit as (
              insert into app.audit_logs (
                actor_id, action, target_type, target_id, details
              )
              select %(actor_id)s, 'kiosk.session_revoked', 'kiosk_session',
                     id::text, %(details)s
              from revoked
            )
            select exists(select 1 from revoked)
            """,
            {
                "session_id": session_id,
                "actor_id": actor_id,
                "now": now,
                "details": Jsonb({"reason": "administrator_revocation"}),
            },
        )
        row = await cursor.fetchone()
        if not row or not row[0]:
            raise RuntimeError("Locked kiosk session was not revoked")
        return True

    async def rate_limit_is_blocked(
        self, key_hash: str, action: str, now: datetime
    ) -> bool:
        cursor = await self._connection.execute(
            """
            select blocked_until > %s
            from app.rate_limit_buckets
            where bucket_key_hash = %s and action = %s
            """,
            (now, key_hash, action),
        )
        row = await cursor.fetchone()
        return bool(row and row[0])

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
        cursor = await self._connection.execute(
            """
            insert into app.rate_limit_buckets (
              bucket_key_hash, action, window_started_at,
              attempt_count, blocked_until, updated_at
            ) values (%s, %s, %s, 1, null, %s)
            on conflict (bucket_key_hash, action) do update
            set window_started_at = case
                  when app.rate_limit_buckets.window_started_at + %s <= %s
                    then %s
                  else app.rate_limit_buckets.window_started_at
                end,
                attempt_count = case
                  when app.rate_limit_buckets.window_started_at + %s <= %s
                    then 1
                  else app.rate_limit_buckets.attempt_count + 1
                end,
                blocked_until = case
                  when app.rate_limit_buckets.blocked_until > %s
                    then app.rate_limit_buckets.blocked_until
                  when (
                    case
                      when app.rate_limit_buckets.window_started_at + %s <= %s
                        then 1
                      else app.rate_limit_buckets.attempt_count + 1
                    end
                  ) >= %s
                    then %s + %s
                  else null
                end,
                updated_at = %s
            returning blocked_until > %s
            """,
            (
                key_hash,
                action,
                now,
                now,
                window,
                now,
                now,
                window,
                now,
                now,
                window,
                now,
                limit,
                now,
                block_for,
                now,
                now,
            ),
        )
        row = await cursor.fetchone()
        return bool(row and row[0])

    async def clear_rate_limit(self, key_hash: str, action: str) -> None:
        await self._connection.execute(
            """
            delete from app.rate_limit_buckets
            where bucket_key_hash = %s and action = %s
            """,
            (key_hash, action),
        )
