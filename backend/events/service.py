from datetime import date
from uuid import UUID

from backend.core.errors import ApiError
from backend.events.models import EventOccurrence, EventSeries
from backend.events.recurrence import (
    expand_weekly_occurrences,
    validate_event_duration,
)
from backend.events.repository import (
    EVENT_RESULT_TOO_LARGE,
    MAX_EVENT_CANDIDATES,
    EventRepository,
)
from backend.events.schemas import (
    EventCreate,
    EventSeriesFilters,
    EventSeriesPage,
    EventUpdate,
)
from backend.identity.models import AuthenticatedUser

EVENT_NOT_FOUND = ("EVENT_NOT_FOUND", "행사 정보를 찾을 수 없습니다.", 404)
FORBIDDEN = ("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403)
MAX_EVENT_OCCURRENCES = 1000


class EventService:
    def __init__(self, repository: EventRepository) -> None:
        self._repository = repository

    async def occurrences(
        self,
        user: AuthenticatedUser,
        range_start: date,
        range_end: date,
    ) -> list[EventOccurrence]:
        if not await self._repository.has_completed_student_identity(user.user_id):
            raise ApiError("PROFILE_REQUIRED", "학생 정보를 먼저 등록해 주세요.", 403)
        series = await self._repository.candidate_series(range_start, range_end)
        if len(series) > MAX_EVENT_CANDIDATES:
            raise ApiError(*EVENT_RESULT_TOO_LARGE)
        occurrences: list[EventOccurrence] = []
        for item in series:
            for occurrence in expand_weekly_occurrences(
                item, range_start, range_end
            ):
                if len(occurrences) >= MAX_EVENT_OCCURRENCES:
                    raise ApiError(*EVENT_RESULT_TOO_LARGE)
                occurrences.append(occurrence)
        return sorted(
            occurrences,
            key=lambda item: (item.local_start, str(item.event_id), item.occurrence_id),
        )

    async def list_series(
        self,
        actor: AuthenticatedUser,
        filters: EventSeriesFilters,
    ) -> EventSeriesPage:
        await self._require_active_staff(actor.user_id)
        return await self._repository.list_series(filters)

    async def create(
        self, command: EventCreate, actor: AuthenticatedUser
    ) -> EventSeries:
        await self._require_active_staff(actor.user_id)
        self._validate_command_duration(command)
        return await self._repository.create(command, actor.user_id)

    async def update(
        self,
        event_id: UUID,
        command: EventUpdate,
        actor: AuthenticatedUser,
    ) -> EventSeries:
        await self._require_active_staff(actor.user_id)
        self._validate_command_duration(command)
        series = await self._repository.update(event_id, command, actor.user_id)
        if series is None:
            raise ApiError(*EVENT_NOT_FOUND)
        return series

    async def delete(self, event_id: UUID, actor: AuthenticatedUser) -> None:
        await self._require_active_staff(actor.user_id)
        if not await self._repository.delete(event_id, actor.user_id):
            raise ApiError(*EVENT_NOT_FOUND)

    async def _require_active_staff(self, user_id: UUID) -> None:
        if await self._repository.active_staff_role(user_id) not in {
            "teacher",
            "admin",
        }:
            raise ApiError(*FORBIDDEN)

    @staticmethod
    def _validate_command_duration(command: EventCreate | EventUpdate) -> None:
        try:
            validate_event_duration(command.starts_at, command.ends_at)
        except ValueError:
            raise ApiError(
                "VALIDATION_ERROR", "입력값을 확인해 주세요.", 422
            ) from None
