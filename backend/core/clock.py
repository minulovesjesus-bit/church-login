from datetime import UTC, datetime, timedelta
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class FrozenClock:
    def __init__(self, current: datetime) -> None:
        if current.tzinfo is None:
            raise ValueError("FrozenClock requires a timezone-aware datetime")
        self._current = current.astimezone(UTC)

    def now(self) -> datetime:
        return self._current

    def advance(self, **duration: float) -> None:
        self._current += timedelta(**duration)
