from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest

from backend.events.models import EventSeries
from backend.events.recurrence import SEOUL, expand_weekly_occurrences

SERIES_ID = UUID("00000000-0000-4000-8000-000000000001")


def event_series(
    *,
    starts_at: datetime,
    ends_at: datetime,
    repeat_weekly: bool = False,
    repeat_until: date | None = None,
) -> EventSeries:
    return EventSeries(
        id=SERIES_ID,
        title="주일예배",
        description="함께 드리는 예배",
        location="본당",
        starts_at=starts_at,
        ends_at=ends_at,
        repeat_weekly=repeat_weekly,
        repeat_until=repeat_until,
    )


def test_weekly_series_expands_in_seoul_time_and_includes_repeat_until() -> None:
    series = event_series(
        starts_at=datetime(2026, 8, 23, 2, tzinfo=UTC),
        ends_at=datetime(2026, 8, 23, 3, 30, tzinfo=UTC),
        repeat_weekly=True,
        repeat_until=date(2026, 9, 6),
    )

    occurrences = expand_weekly_occurrences(
        series, date(2026, 8, 31), date(2026, 9, 7)
    )

    assert [item.local_start.date() for item in occurrences] == [date(2026, 9, 6)]
    assert occurrences[0].local_start.hour == 11
    assert occurrences[0].local_start.tzinfo == SEOUL
    assert occurrences[0].occurrence_id == f"{SERIES_ID}:2026-09-06"


def test_one_time_event_outside_range_is_not_returned() -> None:
    series = event_series(
        starts_at=datetime(2026, 8, 23, 2, tzinfo=UTC),
        ends_at=datetime(2026, 8, 23, 3, tzinfo=UTC),
    )

    assert expand_weekly_occurrences(
        series, date(2026, 9, 1), date(2026, 9, 7)
    ) == []


def test_occurrence_is_included_when_only_its_tail_intersects_the_range() -> None:
    series = event_series(
        starts_at=datetime(2026, 8, 31, 14, tzinfo=UTC),
        ends_at=datetime(2026, 8, 31, 16, tzinfo=UTC),
    )

    occurrences = expand_weekly_occurrences(
        series, date(2026, 9, 1), date(2026, 9, 2)
    )

    assert len(occurrences) == 1
    assert occurrences[0].local_start == datetime(2026, 8, 31, 23, tzinfo=SEOUL)
    assert occurrences[0].local_end == datetime(2026, 9, 1, 1, tzinfo=SEOUL)


def test_ancient_indefinite_series_fast_forwards_and_returns_only_bounded_window() -> None:
    series = event_series(
        starts_at=datetime(1900, 1, 7, 2, tzinfo=UTC),
        ends_at=datetime(1900, 1, 7, 3, 30, tzinfo=UTC),
        repeat_weekly=True,
    )

    occurrences = expand_weekly_occurrences(
        series, date(2026, 8, 17), date(2026, 9, 28)
    )

    assert len(occurrences) == 6
    assert occurrences[0].local_start.date() == date(2026, 8, 23)
    assert occurrences[-1].local_start.date() == date(2026, 9, 27)


def test_recurrence_rejects_invalid_or_unbounded_request_ranges() -> None:
    series = event_series(
        starts_at=datetime(2026, 8, 23, 2, tzinfo=UTC),
        ends_at=datetime(2026, 8, 23, 3, tzinfo=UTC),
        repeat_weekly=True,
    )

    with pytest.raises(ValueError, match="after range_start"):
        expand_weekly_occurrences(series, date(2026, 8, 23), date(2026, 8, 23))
    with pytest.raises(ValueError, match="42 days"):
        expand_weekly_occurrences(series, date(2026, 8, 23), date(2026, 10, 5))


def test_event_duration_allows_exactly_seven_days() -> None:
    starts_at = datetime(2026, 8, 23, 2, tzinfo=UTC)
    series = event_series(starts_at=starts_at, ends_at=starts_at + timedelta(days=7))

    occurrences = expand_weekly_occurrences(
        series, date(2026, 8, 23), date(2026, 8, 24)
    )

    assert len(occurrences) == 1


def test_event_duration_rejects_more_than_seven_days_before_expansion() -> None:
    starts_at = datetime(2026, 8, 23, 2, tzinfo=UTC)
    series = event_series(
        starts_at=starts_at,
        ends_at=starts_at + timedelta(days=7, seconds=1),
        repeat_weekly=True,
    )

    with pytest.raises(ValueError, match="7 days"):
        expand_weekly_occurrences(
            series, date(2026, 8, 23), date(2026, 8, 24)
        )


def test_ancient_adversarial_long_duration_is_rejected_before_weekly_loop() -> None:
    series = event_series(
        starts_at=datetime(1, 1, 1, tzinfo=UTC),
        ends_at=datetime(9999, 1, 1, tzinfo=UTC),
        repeat_weekly=True,
    )

    with pytest.raises(ValueError, match="7 days"):
        expand_weekly_occurrences(
            series, date(9998, 1, 1), date(9998, 2, 12)
        )
