from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from backend.events.models import EventOccurrence, EventSeries

SEOUL = ZoneInfo("Asia/Seoul")
MAX_RANGE_DAYS = 42


def _require_aware_instant(value: datetime, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be offset-aware")


def expand_weekly_occurrences(
    series: EventSeries,
    range_start: date,
    range_end: date,
) -> list[EventOccurrence]:
    range_days = (range_end - range_start).days
    if range_days <= 0:
        raise ValueError("range_end must be after range_start")
    if range_days > MAX_RANGE_DAYS:
        raise ValueError("event range must not exceed 42 days")

    _require_aware_instant(series.starts_at, "starts_at")
    _require_aware_instant(series.ends_at, "ends_at")
    duration = series.ends_at - series.starts_at
    if duration <= timedelta(0):
        raise ValueError("ends_at must be after starts_at")

    range_start_local = datetime.combine(range_start, time.min, tzinfo=SEOUL)
    range_end_local = datetime.combine(range_end, time.min, tzinfo=SEOUL)
    cursor = series.starts_at.astimezone(SEOUL)

    if series.repeat_weekly and cursor + duration <= range_start_local:
        weeks_to_skip = (range_start_local - (cursor + duration)) // timedelta(
            weeks=1
        )
        cursor += timedelta(weeks=weeks_to_skip + 1)

    occurrences: list[EventOccurrence] = []
    while cursor < range_end_local:
        if series.repeat_until is not None and cursor.date() > series.repeat_until:
            break
        local_end = cursor + duration
        if cursor < range_end_local and local_end > range_start_local:
            occurrences.append(
                EventOccurrence(
                    occurrence_id=f"{series.id}:{cursor.date().isoformat()}",
                    event_id=series.id,
                    title=series.title,
                    description=series.description,
                    local_start=cursor,
                    local_end=local_end,
                    location=series.location,
                )
            )
        if not series.repeat_weekly:
            break
        cursor += timedelta(weeks=1)

    return occurrences
