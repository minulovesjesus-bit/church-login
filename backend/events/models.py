from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID


@dataclass(frozen=True)
class EventSeries:
    id: UUID
    title: str
    starts_at: datetime
    ends_at: datetime
    repeat_weekly: bool
    description: str | None = None
    location: str | None = None
    repeat_until: date | None = None
    created_by: UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class EventOccurrence:
    occurrence_id: str
    event_id: UUID
    title: str
    description: str | None
    local_start: datetime
    local_end: datetime
    location: str | None
