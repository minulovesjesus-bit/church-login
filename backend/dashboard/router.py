from typing import Annotated, Any

from fastapi import APIRouter, Depends

from backend.attendance.repository import AttendanceRepository
from backend.core.db import get_database_connection
from backend.dashboard.schemas import TeacherDashboardView
from backend.dashboard.service import DashboardService
from backend.identity.models import AuthenticatedUser
from backend.identity.router import require_teacher
from backend.students.repository import StudentRepository

router = APIRouter(prefix="/api")

DashboardConnection = Annotated[
    Any, Depends(get_database_connection, scope="function")
]
TeacherUser = Annotated[
    AuthenticatedUser, Depends(require_teacher, scope="function")
]


async def get_dashboard_service(
    connection: DashboardConnection,
) -> DashboardService:
    return DashboardService(
        AttendanceRepository(connection),
        StudentRepository(connection),
    )


DashboardServiceDependency = Annotated[
    DashboardService, Depends(get_dashboard_service, scope="function")
]


@router.get("/teacher/dashboard", response_model=TeacherDashboardView)
async def teacher_dashboard(
    _teacher: TeacherUser,
    service: DashboardServiceDependency,
) -> TeacherDashboardView:
    return await service.teacher_dashboard()
