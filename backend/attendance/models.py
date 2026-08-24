from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum
from uuid import UUID


class Direction(str, Enum):
    IN = "IN"
    OUT = "OUT"


class Source(str, Enum):
    QR = "QR"
    MANUAL = "MANUAL"


@dataclass(frozen=True)
class AttendanceScan:
    id: UUID
    student_id: UUID
    attendance_date: date
    direction: Direction
    scanned_at: datetime
    kiosk_session_id: UUID | None
    request_id: UUID
    qr_issued_at: datetime | None
    source: Source
    recorded_by: UUID | None
    voided_at: datetime | None
    voided_by: UUID | None
    void_reason: str | None
    kiosk_device_name: str | None = None
