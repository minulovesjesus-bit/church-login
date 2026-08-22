import re
from datetime import date, datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

SEOUL_TIMEZONE = ZoneInfo("Asia/Seoul")


class StudentProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    birth_date: date
    phone: str
    guardian_phone: str

    @field_validator("birth_date")
    @classmethod
    def birth_date_cannot_be_in_the_future(cls, value: date) -> date:
        if value > datetime.now(SEOUL_TIMEZONE).date():
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


class TeacherApplicationStatus(StrEnum):
    NONE = "none"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class StaffRole(StrEnum):
    TEACHER = "teacher"
    ADMIN = "admin"


class TeacherApplicationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    phone: str

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value)
        if not 10 <= len(digits) <= 11:
            raise ValueError("올바른 연락처를 입력해 주세요.")
        return digits


class TeacherApplicationView(BaseModel):
    id: UUID
    user_id: UUID
    email: str
    name: str
    phone: str
    status: TeacherApplicationStatus
    rejection_reason: str | None


class TeacherApplicationStateView(BaseModel):
    status: TeacherApplicationStatus
    rejection_reason: str | None = None


class RejectTeacherApplicationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rejection_reason: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
    ]


class StaffRoleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: StaffRole


class StaffMemberView(BaseModel):
    user_id: UUID
    email: str
    name: str
    phone: str | None
    role: StaffRole
