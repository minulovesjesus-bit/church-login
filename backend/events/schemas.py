from datetime import date, datetime
from typing import Annotated, Self
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SEOUL = ZoneInfo("Asia/Seoul")

Title = Annotated[str, Field(min_length=1, max_length=120)]
Description = Annotated[str, Field(min_length=1, max_length=2000)]
Location = Annotated[str, Field(min_length=1, max_length=200)]


def _normalize_text(value: object) -> object:
    if not isinstance(value, str):
        return value
    return " ".join(value.split())


class EventRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: date = Field(alias="from")
    end: date = Field(alias="to")

    @model_validator(mode="after")
    def validate_range(self) -> Self:
        range_days = (self.end - self.start).days
        if range_days <= 0:
            raise ValueError("to must be after from")
        if range_days > 42:
            raise ValueError("event range must not exceed 42 days")
        return self


class EventCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    description: Description | None = None
    location: Location | None = None
    starts_at: datetime
    ends_at: datetime
    repeat_weekly: bool = False
    repeat_until: date | None = None

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value: object) -> object:
        return _normalize_text(value)

    @field_validator("description", "location", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        normalized = _normalize_text(value)
        return normalized or None

    @model_validator(mode="after")
    def validate_series(self) -> Self:
        for field_name, value in (
            ("starts_at", self.starts_at),
            ("ends_at", self.ends_at),
        ):
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError(f"{field_name} must be offset-aware")
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if not self.repeat_weekly and self.repeat_until is not None:
            raise ValueError("repeat_until is only valid for weekly events")
        first_seoul_date = self.starts_at.astimezone(SEOUL).date()
        if self.repeat_until is not None and self.repeat_until < first_seoul_date:
            raise ValueError("repeat_until must include the first occurrence")
        return self


class EventCreate(EventCommand):
    pass


class EventUpdate(EventCommand):
    pass


class EventSeriesView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    description: str | None
    location: str | None
    starts_at: datetime
    ends_at: datetime
    repeat_weekly: bool
    repeat_until: date | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class EventOccurrenceView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    occurrence_id: str
    event_id: UUID
    title: str
    description: str | None
    local_start: datetime
    local_end: datetime
    location: str | None
