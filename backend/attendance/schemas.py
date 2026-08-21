from datetime import date, datetime
from enum import Enum
from typing import Self
from uuid import UUID

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
