from datetime import date

from pydantic import BaseModel, Field

from backend.attendance.schemas import TeacherAttendanceItem


class TeacherDashboardView(BaseModel):
    today_attendees: int = Field(ge=0)
    currently_inside: int = Field(ge=0)
    week_attendees: int = Field(ge=0)
    statistics_target_students: int = Field(ge=0)
    recent_attendance: list[TeacherAttendanceItem] = Field(max_length=10)
    as_of_date: date
    timezone: str = "Asia/Seoul"
