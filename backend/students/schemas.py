import re
from datetime import date, datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

SEOUL = ZoneInfo("Asia/Seoul")


class StatisticsFilter(StrEnum):
    ALL = "all"
    INCLUDED = "included"
    EXCLUDED = "excluded"


class StudentListFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: Annotated[str, StringConstraints(max_length=80)] | None = None
    statistics: StatisticsFilter = StatisticsFilter.ALL
    cursor: Annotated[str, StringConstraints(min_length=1, max_length=2048)] | None = None
    page_size: int = Field(default=50, ge=1, le=100)

    @field_validator("query", mode="before")
    @classmethod
    def normalize_query(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.split())
        return normalized or None


class TeacherStudentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    birth_date: date
    phone: str
    guardian_phone: str
    include_in_statistics: bool

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.split())

    @field_validator("phone", "guardian_phone", mode="before")
    @classmethod
    def normalize_phone(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        digits = re.sub(r"\D", "", value)
        if not 10 <= len(digits) <= 11:
            raise ValueError("올바른 연락처를 입력해 주세요.")
        return digits

    @field_validator("birth_date")
    @classmethod
    def birth_date_cannot_be_in_the_future(cls, value: date) -> date:
        if value > datetime.now(SEOUL).date():
            raise ValueError("생년월일은 미래일 수 없습니다.")
        return value


class TeacherStudentView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    email: str
    name: str
    birth_date: date
    phone: str
    guardian_phone: str
    include_in_statistics: bool


class TeacherStudentPage(BaseModel):
    items: list[TeacherStudentView]
    next_cursor: str | None
    page_size: int = Field(ge=1, le=100)
