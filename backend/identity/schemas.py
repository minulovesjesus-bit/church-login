import re
from datetime import UTC, date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator


class StudentProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    birth_date: date
    phone: str
    guardian_phone: str

    @field_validator("birth_date")
    @classmethod
    def birth_date_cannot_be_in_the_future(cls, value: date) -> date:
        if value > datetime.now(UTC).date():
            raise ValueError("생년월일은 미래일 수 없습니다.")
        return value

    @field_validator("phone", "guardian_phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value)
        if not 10 <= len(digits) <= 11:
            raise ValueError("올바른 연락처를 입력해 주세요.")
        return digits


class StudentProfileView(BaseModel):
    name: str
    birth_date: date
    phone: str
    guardian_phone: str
    include_in_statistics: bool


class CapabilitiesView(BaseModel):
    student: bool
    teacher: bool
    admin: bool


class CurrentIdentityView(BaseModel):
    user_id: str
    email: str
    provider: str
    email_verified: bool
    onboarding_completed: bool
    capabilities: CapabilitiesView
