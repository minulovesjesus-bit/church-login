from datetime import date, datetime, time
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from backend.core.errors import ApiError
from backend.events.models import EventSeries
from backend.events.schemas import (
    EventCreate,
    EventSeriesFilters,
    EventSeriesPage,
    EventUpdate,
)

SEOUL = ZoneInfo("Asia/Seoul")
EVENT_COLUMNS = """
id, title, description, location, starts_at, ends_at, repeat_weekly,
repeat_until, created_by, created_at, updated_at
"""
MUTABLE_FIELDS = (
    "title",
    "description",
    "location",
    "starts_at",
    "ends_at",
    "repeat_weekly",
    "repeat_until",
)
MAX_EVENT_CANDIDATES = 1000
EVENT_RESULT_TOO_LARGE = (
    "EVENT_RESULT_TOO_LARGE",
    "조회할 행사가 너무 많습니다. 조회 기간을 줄여 주세요.",
    422,
)


class EventRepository:
    def __init__(self, connection: Any) -> None:
        self.connection = connection

    async def has_completed_student_identity(self, user_id: UUID) -> bool:
        cursor = await self.connection.execute(
            """
            select exists(
              select 1
              from app.user_profiles profile
              join app.student_profiles student using (user_id)
              where profile.user_id = %s
            )
            """,
            (user_id,),
        )
        row = await cursor.fetchone()
        return bool(row and row[0])

    async def active_staff_role(self, user_id: UUID) -> str | None:
        cursor = await self.connection.execute(
            """
            select role::text
            from app.staff_memberships
            where user_id = %s and role in ('teacher', 'admin')
            """,
            (user_id,),
        )
        row = await cursor.fetchone()
        return str(row[0]) if row is not None else None

    async def candidate_series(
        self, range_start: date, range_end: date
    ) -> list[EventSeries]:
        range_start_instant = datetime.combine(range_start, time.min, tzinfo=SEOUL)
        range_end_instant = datetime.combine(range_end, time.min, tzinfo=SEOUL)
        cursor = await self.connection.execute(
            f"""
            select {EVENT_COLUMNS}
            from app.events
            where starts_at < %s
              and (
                (not repeat_weekly and ends_at > %s)
                or
                (
                  repeat_weekly
                  and (
                    repeat_until is null
                    or (
                      (repeat_until + 1)::timestamp
                      at time zone 'Asia/Seoul'
                    ) + (ends_at - starts_at) > %s
                  )
                )
              )
            order by starts_at, id
            limit %s
            """,
            (
                range_end_instant,
                range_start_instant,
                range_start_instant,
                MAX_EVENT_CANDIDATES + 1,
            ),
        )
        series = [self._series(row) for row in await cursor.fetchall()]
        if len(series) > MAX_EVENT_CANDIDATES:
            raise ApiError(*EVENT_RESULT_TOO_LARGE)
        return series

    async def list_series(self, filters: EventSeriesFilters) -> EventSeriesPage:
        count_cursor = await self.connection.execute(
            "select count(*) from app.events"
        )
        count_row = await count_cursor.fetchone()
        total = int(count_row[0]) if count_row is not None else 0
        cursor = await self.connection.execute(
            f"""
            select {EVENT_COLUMNS}
            from app.events
            order by starts_at, id
            limit %s offset %s
            """,
            (
                filters.page_size,
                (filters.page - 1) * filters.page_size,
            ),
        )
        return EventSeriesPage(
            items=[self._series(row) for row in await cursor.fetchall()],
            total=total,
            page=filters.page,
            page_size=filters.page_size,
        )

    async def create(self, command: EventCreate, actor_id: UUID) -> EventSeries:
        details = Jsonb({"changed_fields": list(MUTABLE_FIELDS)})
        cursor = await self.connection.execute(
            f"""
            with saved as (
              insert into app.events (
                title, description, location, starts_at, ends_at,
                repeat_weekly, repeat_until, created_by
              ) values (%s, %s, %s, %s, %s, %s, %s, %s)
              returning {EVENT_COLUMNS}
            ), audit as (
              insert into app.audit_logs (
                actor_id, action, target_type, target_id, details
              )
              select %s, 'event.created', 'event', id::text, %s
              from saved
            )
            select {EVENT_COLUMNS} from saved
            """,
            (
                command.title,
                command.description,
                command.location,
                command.starts_at,
                command.ends_at,
                command.repeat_weekly,
                command.repeat_until,
                actor_id,
                actor_id,
                details,
            ),
        )
        row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("Event creation returned no row")
        return self._series(row)

    async def update(
        self, event_id: UUID, command: EventUpdate, actor_id: UUID
    ) -> EventSeries | None:
        current_cursor = await self.connection.execute(
            f"select {EVENT_COLUMNS} from app.events where id = %s for update",
            (event_id,),
        )
        current_row = await current_cursor.fetchone()
        if current_row is None:
            return None
        current = self._series(current_row)
        changed_fields = [
            field_name
            for field_name in MUTABLE_FIELDS
            if getattr(current, field_name) != getattr(command, field_name)
        ]
        cursor = await self.connection.execute(
            f"""
            with saved as (
              update app.events
              set title = %s,
                  description = %s,
                  location = %s,
                  starts_at = %s,
                  ends_at = %s,
                  repeat_weekly = %s,
                  repeat_until = %s,
                  updated_at = now()
              where id = %s
              returning {EVENT_COLUMNS}
            ), audit as (
              insert into app.audit_logs (
                actor_id, action, target_type, target_id, details
              )
              select %s, 'event.updated', 'event', id::text, %s
              from saved
            )
            select {EVENT_COLUMNS} from saved
            """,
            (
                command.title,
                command.description,
                command.location,
                command.starts_at,
                command.ends_at,
                command.repeat_weekly,
                command.repeat_until,
                event_id,
                actor_id,
                Jsonb({"changed_fields": changed_fields}),
            ),
        )
        row = await cursor.fetchone()
        return self._series(row) if row is not None else None

    async def delete(self, event_id: UUID, actor_id: UUID) -> bool:
        cursor = await self.connection.execute(
            """
            with removed as (
              delete from app.events
              where id = %s
              returning id
            ), audit as (
              insert into app.audit_logs (
                actor_id, action, target_type, target_id, details
              )
              select %s, 'event.deleted', 'event', id::text, %s
              from removed
            )
            select exists(select 1 from removed)
            """,
            (event_id, actor_id, Jsonb({"changed_fields": []})),
        )
        row = await cursor.fetchone()
        return bool(row and row[0])

    @staticmethod
    def _series(row: tuple[Any, ...]) -> EventSeries:
        return EventSeries(
            id=row[0],
            title=row[1],
            description=row[2],
            location=row[3],
            starts_at=row[4],
            ends_at=row[5],
            repeat_weekly=row[6],
            repeat_until=row[7],
            created_by=row[8],
            created_at=row[9],
            updated_at=row[10],
        )
