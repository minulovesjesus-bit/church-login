from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

from backend.identity.models import AuthenticatedUser


@dataclass(frozen=True)
class StudentProfileRecord:
    user_id: UUID
    email: str
    name: str
    birth_date: date
    phone: str
    guardian_phone: str
    include_in_statistics: bool


@dataclass(frozen=True)
class IdentityState:
    onboarding_completed: bool
    staff_role: str | None


class IdentityRepository:
    def __init__(self, connection: Any) -> None:
        self._connection = connection

    async def upsert_student_profile(
        self,
        user: AuthenticatedUser,
        *,
        name: str,
        birth_date: date,
        phone: str,
        guardian_phone: str,
    ) -> StudentProfileRecord:
        cursor = await self._connection.execute(
            """
            with saved_user as (
                insert into app.user_profiles (user_id, email, name, phone)
                values (%s, %s, %s, %s)
                on conflict (user_id) do update
                set email = excluded.email,
                    name = excluded.name,
                    phone = excluded.phone,
                    updated_at = now()
                returning user_id, email, name, phone
            ), saved_student as (
                insert into app.student_profiles (user_id, birth_date, guardian_phone)
                values (%s, %s, %s)
                on conflict (user_id) do update
                set birth_date = excluded.birth_date,
                    guardian_phone = excluded.guardian_phone
                returning user_id, birth_date, guardian_phone, include_in_statistics
            )
            select saved_user.user_id, saved_user.email, saved_user.name,
                   saved_user.phone, saved_student.birth_date,
                   saved_student.guardian_phone, saved_student.include_in_statistics
            from saved_user join saved_student using (user_id)
            """,
            (
                user.user_id,
                user.email,
                name,
                phone,
                user.user_id,
                birth_date,
                guardian_phone,
            ),
        )
        row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("Student profile upsert did not return a profile")
        return StudentProfileRecord(*row)

    async def identity_state(self, user_id: UUID) -> IdentityState:
        cursor = await self._connection.execute(
            """
            select exists(
                select 1 from app.student_profiles where user_id = %s
            ) as onboarding_completed,
            (
                select role::text from app.staff_memberships where user_id = %s
            ) as staff_role
            """,
            (user_id, user_id),
        )
        row = await cursor.fetchone()
        if row is None:
            return IdentityState(onboarding_completed=False, staff_role=None)
        return IdentityState(onboarding_completed=bool(row[0]), staff_role=row[1])
