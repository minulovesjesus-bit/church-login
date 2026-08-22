from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError

from backend.identity import schemas


def freeze_datetime(monkeypatch: pytest.MonkeyPatch, instant: datetime) -> None:
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant if tz is None else instant.astimezone(tz)

    monkeypatch.setattr(schemas, "datetime", FrozenDateTime)


def test_birth_date_uses_seoul_day_at_the_utc_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before_seoul_midnight = datetime(2026, 8, 21, 14, 59, tzinfo=UTC)
    after_seoul_midnight = datetime(2026, 8, 21, 15, 1, tzinfo=UTC)
    profile = {
        "name": "서울 경계 학생",
        "birth_date": date(2026, 8, 22),
        "phone": "01011112222",
        "guardian_phone": "01033334444",
    }

    freeze_datetime(monkeypatch, before_seoul_midnight)
    with pytest.raises(ValidationError):
        schemas.StudentProfileInput.model_validate(profile)

    freeze_datetime(monkeypatch, after_seoul_midnight)
    assert schemas.StudentProfileInput.model_validate(profile).birth_date == date(
        2026, 8, 22
    )
