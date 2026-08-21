from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from backend.core.auth import get_current_user
from backend.core.db import get_database_connection
from backend.events.repository import EventRepository
from backend.events.schemas import (
    EventCreate,
    EventOccurrenceView,
    EventRange,
    EventSeriesFilters,
    EventSeriesPage,
    EventSeriesView,
    EventUpdate,
)
from backend.events.service import EventService
from backend.identity.models import AuthenticatedUser
from backend.identity.router import require_teacher

router = APIRouter(prefix="/api")


DatabaseConnection = Annotated[
    Any, Depends(get_database_connection, scope="function")
]


async def get_event_repository(
    connection: DatabaseConnection,
) -> EventRepository:
    return EventRepository(connection)


EventRepositoryDependency = Annotated[
    EventRepository, Depends(get_event_repository, scope="function")
]


async def get_event_service(
    repository: EventRepositoryDependency,
) -> EventService:
    return EventService(repository)


EventServiceDependency = Annotated[
    EventService, Depends(get_event_service, scope="function")
]
CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]
TeacherUser = Annotated[AuthenticatedUser, Depends(require_teacher, scope="function")]


@router.get("/events", response_model=list[EventOccurrenceView])
async def list_events(
    user: CurrentUser,
    service: EventServiceDependency,
    date_range: Annotated[EventRange, Query()],
) -> list[EventOccurrenceView]:
    return await service.occurrences(user, date_range.start, date_range.end)


@router.get("/teacher/events", response_model=EventSeriesPage)
async def list_event_series(
    teacher: TeacherUser,
    service: EventServiceDependency,
    filters: Annotated[EventSeriesFilters, Query()],
) -> EventSeriesPage:
    return await service.list_series(teacher, filters)


@router.post(
    "/teacher/events",
    response_model=EventSeriesView,
    status_code=status.HTTP_201_CREATED,
)
async def create_event(
    command: EventCreate,
    teacher: TeacherUser,
    service: EventServiceDependency,
) -> EventSeriesView:
    return await service.create(command, teacher)


@router.patch("/teacher/events/{event_id}", response_model=EventSeriesView)
async def update_event(
    event_id: UUID,
    command: EventUpdate,
    teacher: TeacherUser,
    service: EventServiceDependency,
) -> EventSeriesView:
    return await service.update(event_id, command, teacher)


@router.delete(
    "/teacher/events/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_event(
    event_id: UUID,
    teacher: TeacherUser,
    service: EventServiceDependency,
) -> Response:
    await service.delete(event_id, teacher)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
