from datetime import date, datetime, timedelta
from enum import Enum
from typing import Self
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.attendance.models import AttendanceScan, Direction, Source


class ScanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    qr_token: str = Field(min_length=1, max_length=4096)
    request_id: UUID


class ScanResult(BaseModel):
    scan_id: UUID
    direction: Direction
    scanned_at: datetime
    duplicate: bool
    cooldown_remaining: float | None = Field(default=None, ge=0)

    @classmethod
    def accepted(cls, scan: AttendanceScan, *, duplicate: bool) -> "ScanResult":
        return cls(
            scan_id=scan.id,
            direction=scan.direction,
            scanned_at=scan.scanned_at,
            duplicate=duplicate,
            cooldown_remaining=None,
        )

    @classmethod
    def cooldown(cls, scan: AttendanceScan, *, remaining: float) -> "ScanResult":
        return cls(
            scan_id=scan.id,
            direction=scan.direction,
            scanned_at=scan.scanned_at,
            duplicate=False,
            cooldown_remaining=remaining,
        )


class CorrectionMode(str, Enum):
    VOID = "VOID"
    MANUAL = "MANUAL"


class AttendanceCorrectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: CorrectionMode
    reason: str = Field(min_length=1, max_length=500)
    scan_id: UUID | None = None
    student_id: UUID | None = None
    direction: Direction | None = None
    scanned_at: datetime | None = None

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("reason must not be blank")
        return normalized

    @model_validator(mode="after")
    def validate_mode_fields(self) -> Self:
        if self.mode == CorrectionMode.VOID:
            if self.scan_id is None:
                raise ValueError("VOID correction requires scan_id")
            if any(
                value is not None
                for value in (self.student_id, self.direction, self.scanned_at)
            ):
                raise ValueError("VOID correction accepts only scan_id and reason")
            return self

        if self.scan_id is not None:
            raise ValueError("MANUAL correction cannot include scan_id")
        if self.student_id is None or self.direction is None or self.scanned_at is None:
            raise ValueError(
                "MANUAL correction requires student_id, direction, and scanned_at"
            )
        if self.scanned_at.tzinfo is None or self.scanned_at.utcoffset() is None:
            raise ValueError("scanned_at must include a timezone")
        return self


class AttendanceScanView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    student_id: UUID
    attendance_date: date
    direction: Direction
    scanned_at: datetime
    source: Source
    recorded_by: UUID | None
    voided_at: datetime | None
    voided_by: UUID | None
    void_reason: str | None


class AttendanceStatusFilter(str, Enum):
    ALL = "ALL"
    IN = "IN"
    OUT = "OUT"
    VOIDED = "VOIDED"


def _default_date_to() -> date:
    return datetime.now(tz=ZoneInfo("Asia/Seoul")).date()


def _default_date_from() -> date:
    return _default_date_to() - timedelta(days=29)


class PaginationFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: int = Field(default=1, ge=1, le=10_000)
    page_size: int = Field(default=30, ge=1, le=100)


class TeacherAttendanceFilters(PaginationFilters):
    date_from: date = Field(default_factory=_default_date_from)
    date_to: date = Field(default_factory=_default_date_to)
    status: AttendanceStatusFilter = AttendanceStatusFilter.ALL
    search: str | None = Field(default=None, max_length=80)

    @field_validator("search")
    @classmethod
    def normalize_search(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @model_validator(mode="after")
    def validate_date_range(self) -> Self:
        if self.date_from > self.date_to:
            raise ValueError("date_from must not be after date_to")
        if (self.date_to - self.date_from).days > 365:
            raise ValueError("date range must not exceed 366 days")
        return self


class TeacherStatisticsFilters(PaginationFilters):
    date_from: date = Field(default_factory=_default_date_from)
    date_to: date = Field(default_factory=_default_date_to)
    search: str | None = Field(default=None, max_length=80)

    @field_validator("search")
    @classmethod
    def normalize_search(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @model_validator(mode="after")
    def validate_date_range(self) -> Self:
        if self.date_from > self.date_to:
            raise ValueError("date_from must not be after date_to")
        if (self.date_to - self.date_from).days > 365:
            raise ValueError("date range must not exceed 366 days")
        return self


class AttendanceHistoryPage(BaseModel):
    items: list[AttendanceScanView]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    timezone: str = "Asia/Seoul"


class TeacherAttendanceItem(AttendanceScanView):
    student_name: str
    student_email: str
    excluded_from_statistics: bool


class TeacherAttendancePage(BaseModel):
    items: list[TeacherAttendanceItem]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    timezone: str = "Asia/Seoul"


class CurrentPresenceFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str | None = Field(default=None, max_length=80)
    page: int = Field(default=1, ge=1, le=10_000)
    page_size: int = Field(default=20, ge=1, le=100)

    @field_validator("query", mode="before")
    @classmethod
    def normalize_query(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.split())
        return normalized or None


class CurrentPresenceItem(BaseModel):
    student_id: UUID
    student_name: str
    student_email: str
    student_phone: str
    guardian_phone: str
    birth_date: date
    checked_in_at: datetime
    source: Source
    excluded_from_statistics: bool


class CurrentPresencePage(BaseModel):
    items: list[CurrentPresenceItem]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    as_of_date: date
    timezone: str = "Asia/Seoul"


class StudentStatisticsView(BaseModel):
    attendance_days_this_week: int = Field(ge=0)
    attendance_days_this_month: int = Field(ge=0)
    total_entries: int = Field(ge=0)
    average_stay_seconds: float | None = Field(default=None, ge=0)
    currently_inside: bool
    open_stay_started_at: datetime | None
    as_of_date: date
    timezone: str = "Asia/Seoul"


class TimeOfDayEntry(BaseModel):
    hour: int = Field(ge=0, le=23)
    entries: int = Field(ge=0)


class StudentAttendanceDays(BaseModel):
    student_id: UUID
    student_name: str
    attendance_days: int = Field(ge=0)


class TeacherStatisticsView(BaseModel):
    unique_students_today: int = Field(ge=0)
    unique_students_this_week: int = Field(ge=0)
    unique_students_this_month: int = Field(ge=0)
    currently_inside: int = Field(ge=0)
    average_stay_seconds: float | None = Field(default=None, ge=0)
    time_of_day_entries: list[TimeOfDayEntry]
    student_attendance_days: list[StudentAttendanceDays]
    student_attendance_days_total: int = Field(ge=0)
    student_attendance_days_page: int = Field(ge=1)
    student_attendance_days_page_size: int = Field(ge=1, le=100)
    date_from: date
    date_to: date
    as_of_date: date
    timezone: str = "Asia/Seoul"
