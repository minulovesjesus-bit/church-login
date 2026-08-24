from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from backend.core.db import get_database_connection
from backend.identity.models import AuthenticatedUser
from backend.identity.router import require_admin, require_teacher
from backend.students.repository import StudentRepository
from backend.students.schemas import (
    StudentListFilters,
    TeacherStudentPage,
    TeacherStudentUpdate,
    TeacherStudentView,
)
from backend.students.service import StudentService

router = APIRouter(prefix="/api")

DatabaseConnection = Annotated[Any, Depends(get_database_connection, scope="function")]


async def get_student_repository(connection: DatabaseConnection) -> StudentRepository:
    return StudentRepository(connection)


StudentRepositoryDependency = Annotated[
    StudentRepository,
    Depends(get_student_repository, scope="function"),
]


async def get_student_service(repository: StudentRepositoryDependency) -> StudentService:
    return StudentService(repository)


StudentServiceDependency = Annotated[
    StudentService,
    Depends(get_student_service, scope="function"),
]
TeacherUser = Annotated[AuthenticatedUser, Depends(require_teacher, scope="function")]
AdminUser = Annotated[AuthenticatedUser, Depends(require_admin, scope="function")]


@router.get("/teacher/students", response_model=TeacherStudentPage)
async def list_students(
    teacher: TeacherUser,
    service: StudentServiceDependency,
    filters: Annotated[StudentListFilters, Query()],
) -> TeacherStudentPage:
    return await service.list_students(teacher, filters)


@router.patch("/teacher/students/{student_id}", response_model=TeacherStudentView)
async def update_student(
    student_id: UUID,
    command: TeacherStudentUpdate,
    teacher: TeacherUser,
    service: StudentServiceDependency,
) -> TeacherStudentView:
    return await service.update_student(teacher, student_id, command)


@router.post(
    "/admin/students/{student_id}/promote-to-teacher",
    response_model=TeacherStudentView,
)
async def promote_student_to_teacher(
    student_id: UUID,
    admin: AdminUser,
    service: StudentServiceDependency,
) -> TeacherStudentView:
    return await service.promote_student_to_teacher(admin, student_id)
