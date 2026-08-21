from dataclasses import dataclass
from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb

from backend.students.schemas import (
    StudentListFilters,
    TeacherStudentUpdate,
    TeacherStudentView,
)

MUTABLE_FIELDS = (
    "birth_date",
    "guardian_phone",
    "include_in_statistics",
    "name",
    "phone",
)


@dataclass(frozen=True)
class StudentCursorKey:
    name: str
    user_id: UUID


class StudentRepository:
    def __init__(self, connection: Any) -> None:
        self.connection = connection

    async def active_staff_role(self, user_id: UUID) -> str | None:
        cursor = await self.connection.execute(
            """
            select role::text
            from app.staff_memberships
            where user_id = %s and role in ('teacher', 'admin')
            """,
            (user_id,),
        )
        row = await cursor.fetchone()
        return str(row[0]) if row is not None else None

    async def list_students(
        self,
        filters: StudentListFilters,
        cursor_key: StudentCursorKey | None,
    ) -> list[TeacherStudentView]:
        cursor = await self.connection.execute(
            """
            select profile.user_id, profile.email, profile.name,
                   student.birth_date, profile.phone, student.guardian_phone,
                   student.include_in_statistics
            from app.student_profiles student
            join app.user_profiles profile using (user_id)
            where (
                %(statistics)s = 'all'
                or (%(statistics)s = 'included' and student.include_in_statistics)
                or (%(statistics)s = 'excluded' and not student.include_in_statistics)
              )
              and (
                %(search)s::text is null
                or profile.name ilike %(search)s escape '\\'
                or profile.email ilike %(search)s escape '\\'
                or coalesce(profile.phone, '') ilike %(search)s escape '\\'
                or student.guardian_phone ilike %(search)s escape '\\'
              )
              and (
                %(cursor_name)s::text is null
                or (lower(profile.name), profile.user_id)
                   > (lower(%(cursor_name)s), %(cursor_user_id)s::uuid)
              )
            order by lower(profile.name), profile.user_id
            limit %(limit)s
            """,
            {
                "statistics": filters.statistics.value,
                "search": self._like_pattern(filters.query),
                "cursor_name": cursor_key.name if cursor_key else None,
                "cursor_user_id": str(cursor_key.user_id) if cursor_key else None,
                "limit": filters.page_size + 1,
            },
        )
        return [self._student(row) for row in await cursor.fetchall()]

    async def update_student(
        self,
        student_id: UUID,
        command: TeacherStudentUpdate,
        actor_id: UUID,
    ) -> TeacherStudentView | None:
        # The schema's current_date constraint must use the same business date
        # as request validation, including the UTC/Seoul midnight boundary.
        await self.connection.execute("set local time zone 'Asia/Seoul'")
        cursor = await self.connection.execute(
            """
            select profile.user_id, profile.email, profile.name,
                   student.birth_date, profile.phone, student.guardian_phone,
                   student.include_in_statistics
            from app.user_profiles profile
            join app.student_profiles student using (user_id)
            where profile.user_id = %s
            for update of profile, student
            """,
            (student_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        current = self._student(row)
        changed_fields = [
            field_name
            for field_name in MUTABLE_FIELDS
            if getattr(current, field_name) != getattr(command, field_name)
        ]
        if not changed_fields:
            return current

        if "name" in changed_fields or "phone" in changed_fields:
            await self.connection.execute(
                """
                update app.user_profiles
                set name = %s, phone = %s, updated_at = now()
                where user_id = %s
                """,
                (command.name, command.phone, student_id),
            )
        if any(
            field_name in changed_fields
            for field_name in ("birth_date", "guardian_phone", "include_in_statistics")
        ):
            await self.connection.execute(
                """
                update app.student_profiles
                set birth_date = %s,
                    guardian_phone = %s,
                    include_in_statistics = %s
                where user_id = %s
                """,
                (
                    command.birth_date,
                    command.guardian_phone,
                    command.include_in_statistics,
                    student_id,
                ),
            )
        await self.connection.execute(
            """
            insert into app.audit_logs (
                actor_id, action, target_type, target_id, details
            ) values (%s, 'student.profile_updated', 'student_profile', %s, %s)
            """,
            (
                actor_id,
                str(student_id),
                Jsonb({"changed_fields": changed_fields}),
            ),
        )
        return TeacherStudentView(
            user_id=current.user_id,
            email=current.email,
            **command.model_dump(),
        )

    @staticmethod
    def _like_pattern(query: str | None) -> str | None:
        if query is None:
            return None
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        return f"%{escaped}%"

    @staticmethod
    def _student(row: Any) -> TeacherStudentView:
        return TeacherStudentView(
            user_id=row[0],
            email=row[1],
            name=row[2],
            birth_date=row[3],
            phone=row[4],
            guardian_phone=row[5],
            include_in_statistics=bool(row[6]),
        )
