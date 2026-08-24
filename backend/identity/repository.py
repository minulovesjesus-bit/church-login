from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.schemas import StaffRole, TeacherApplicationStatus


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


@dataclass(frozen=True)
class TeacherApplicationRecord:
    id: UUID
    user_id: UUID
    email: str
    name: str
    phone: str
    status: TeacherApplicationStatus
    rejection_reason: str | None


@dataclass(frozen=True)
class StaffMemberRecord:
    user_id: UUID
    email: str
    name: str
    phone: str | None
    role: StaffRole


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
        await self._connection.execute(
            "select set_config('TimeZone', 'Asia/Seoul', true)"
        )
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
                   saved_student.birth_date, saved_user.phone,
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

    async def student_profile(self, user_id: UUID) -> StudentProfileRecord | None:
        cursor = await self._connection.execute(
            """
            select profile.user_id, profile.email, profile.name,
                   student.birth_date, profile.phone,
                   student.guardian_phone, student.include_in_statistics
            from app.user_profiles profile
            join app.student_profiles student using (user_id)
            where profile.user_id = %s
            """,
            (user_id,),
        )
        row = await cursor.fetchone()
        return StudentProfileRecord(*row) if row is not None else None

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

    async def staff_role(self, user_id: UUID) -> StaffRole | None:
        cursor = await self._connection.execute(
            "select role::text from app.staff_memberships where user_id = %s",
            (user_id,),
        )
        row = await cursor.fetchone()
        return StaffRole(row[0]) if row is not None else None

    async def create_or_get_teacher_application(
        self,
        user: AuthenticatedUser,
        *,
        name: str,
        phone: str,
    ) -> TeacherApplicationRecord:
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
            ), saved_application as (
                insert into app.teacher_applications (user_id)
                select user_id from saved_user
                on conflict (user_id) where status = 'pending'
                do update set user_id = excluded.user_id
                returning id, user_id, status::text, rejection_reason
            )
            select saved_application.id, saved_application.user_id,
                   saved_user.email, saved_user.name, saved_user.phone,
                   saved_application.status, saved_application.rejection_reason
            from saved_application
            join saved_user on saved_user.user_id = saved_application.user_id
            """,
            (user.user_id, user.email, name, phone),
        )
        row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("Teacher application upsert returned no row")
        return self._teacher_application_record(row)

    async def teacher_application_state(
        self, user_id: UUID
    ) -> TeacherApplicationRecord | None:
        cursor = await self._connection.execute(
            """
            select application.id, application.user_id,
                   profile.email, profile.name, profile.phone,
                   application.status::text, application.rejection_reason
            from app.teacher_applications application
            join app.user_profiles profile on profile.user_id = application.user_id
            where application.user_id = %s
            order by application.applied_at desc, application.id desc
            limit 1
            """,
            (user_id,),
        )
        row = await cursor.fetchone()
        return self._teacher_application_record(row) if row is not None else None

    async def bootstrap_initial_admin(self, user: AuthenticatedUser) -> bool:
        await self._serialize_staff_memberships()
        marker_cursor = await self._connection.execute(
            """
            select exists(
                select 1
                from app.audit_logs
                where action = 'staff.bootstrap_admin'
                  and target_type = 'staff_membership'
            )
            """
        )
        marker_row = await marker_cursor.fetchone()
        if marker_row and marker_row[0]:
            return False

        fallback_name = user.email.split("@", maxsplit=1)[0].strip()[:80] or "관리자"
        cursor = await self._connection.execute(
            """
            with saved_user as (
                insert into app.user_profiles (user_id, email, name)
                values (%s, %s, %s)
                on conflict (user_id) do update
                set email = excluded.email,
                    updated_at = now()
                returning user_id
            ), saved_membership as (
                insert into app.staff_memberships (user_id, role, approved_by)
                select user_id, 'admin', %s from saved_user
                on conflict (user_id) do update
                set role = excluded.role,
                    approved_by = excluded.approved_by,
                    updated_at = now()
                returning user_id
            ), audit as (
                insert into app.audit_logs (
                    actor_id, action, target_type, target_id, details
                )
                select %s, 'staff.bootstrap_admin', 'staff_membership',
                       saved_user.user_id::text,
                       jsonb_build_object('role', 'admin')
                from saved_user
            )
            select true from saved_user
            """,
            (
                user.user_id,
                user.email,
                fallback_name,
                user.user_id,
                user.user_id,
            ),
        )
        row = await cursor.fetchone()
        return bool(row and row[0])

    async def decide_teacher_application(
        self,
        actor_id: UUID,
        application_id: UUID,
        *,
        decision: TeacherApplicationStatus,
        rejection_reason: str | None,
    ) -> TeacherApplicationRecord:
        locked = await self._connection.execute(
            """
            select application.user_id, application.status::text
            from app.teacher_applications application
            where application.id = %s
            for update
            """,
            (application_id,),
        )
        locked_row = await locked.fetchone()
        if locked_row is None:
            raise ApiError("APPLICATION_NOT_FOUND", "교사 가입 신청을 찾을 수 없습니다.", 404)
        if locked_row[1] != TeacherApplicationStatus.PENDING:
            raise ApiError("APPLICATION_ALREADY_REVIEWED", "이미 처리된 신청입니다.", 409)

        target_user_id = locked_row[0]
        if decision == TeacherApplicationStatus.APPROVED:
            await self._connection.execute(
                """
                insert into app.staff_memberships (user_id, role, approved_by)
                values (%s, 'teacher', %s)
                on conflict (user_id) do nothing
                """,
                (target_user_id, actor_id),
            )

        cursor = await self._connection.execute(
            """
            with decided as (
                update app.teacher_applications
                set status = %s,
                    reviewed_by = %s,
                    reviewed_at = now(),
                    rejection_reason = %s
                where id = %s
                returning id, user_id, status::text, rejection_reason
            ), audit as (
                insert into app.audit_logs (
                    actor_id, action, target_type, target_id, details
                )
                select %s, %s, 'teacher_application', id::text,
                       jsonb_build_object('status', status::text)
                from decided
            )
            select decided.id, decided.user_id,
                   profile.email, profile.name, profile.phone,
                   decided.status, decided.rejection_reason
            from decided
            join app.user_profiles profile on profile.user_id = decided.user_id
            """,
            (
                decision.value,
                actor_id,
                rejection_reason,
                application_id,
                actor_id,
                f"teacher_application.{decision.value}",
            ),
        )
        row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("Teacher application decision returned no row")
        return self._teacher_application_record(row)

    async def list_pending_teacher_applications(self) -> list[TeacherApplicationRecord]:
        cursor = await self._connection.execute(
            """
            select application.id, application.user_id,
                   profile.email, profile.name, profile.phone,
                   application.status::text, application.rejection_reason
            from app.teacher_applications application
            join app.user_profiles profile on profile.user_id = application.user_id
            where application.status = 'pending'
            order by application.applied_at, application.id
            """
        )
        return [self._teacher_application_record(row) for row in await cursor.fetchall()]

    async def list_staff(self) -> list[StaffMemberRecord]:
        cursor = await self._connection.execute(
            """
            select membership.user_id, profile.email, profile.name, profile.phone,
                   membership.role::text
            from app.staff_memberships membership
            join app.user_profiles profile on profile.user_id = membership.user_id
            order by case membership.role when 'admin' then 0 else 1 end,
                     lower(profile.name), membership.user_id
            """
        )
        return [self._staff_member_record(row) for row in await cursor.fetchall()]

    async def lock_staff_memberships(self) -> list[tuple[UUID, StaffRole]]:
        await self._serialize_staff_memberships()
        cursor = await self._connection.execute(
            """
            select user_id, role::text
            from app.staff_memberships
            order by user_id
            for update
            """
        )
        return [(row[0], StaffRole(row[1])) for row in await cursor.fetchall()]

    async def _serialize_staff_memberships(self) -> None:
        await self._connection.execute(
            "select pg_advisory_xact_lock(%s)", (1_256_784_321,)
        )

    async def staff_member(self, user_id: UUID) -> StaffMemberRecord | None:
        cursor = await self._connection.execute(
            """
            select membership.user_id, profile.email, profile.name, profile.phone,
                   membership.role::text
            from app.staff_memberships membership
            join app.user_profiles profile on profile.user_id = membership.user_id
            where membership.user_id = %s
            """,
            (user_id,),
        )
        row = await cursor.fetchone()
        return self._staff_member_record(row) if row is not None else None

    async def update_staff_role(
        self, actor_id: UUID, target_user_id: UUID, role: StaffRole
    ) -> StaffMemberRecord:
        cursor = await self._connection.execute(
            """
            with changed as (
                update app.staff_memberships
                set role = %s, updated_at = now()
                where user_id = %s
                returning user_id, role::text
            ), audit as (
                insert into app.audit_logs (
                    actor_id, action, target_type, target_id, details
                )
                select %s, 'staff.role_changed', 'staff_membership',
                       user_id::text, jsonb_build_object('role', role::text)
                from changed
            )
            select changed.user_id, profile.email, profile.name, profile.phone,
                   changed.role
            from changed
            join app.user_profiles profile on profile.user_id = changed.user_id
            """,
            (role.value, target_user_id, actor_id),
        )
        row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("Staff role update returned no row")
        return self._staff_member_record(row)

    @staticmethod
    def _teacher_application_record(row: Any) -> TeacherApplicationRecord:
        return TeacherApplicationRecord(
            id=row[0],
            user_id=row[1],
            email=row[2],
            name=row[3],
            phone=row[4],
            status=TeacherApplicationStatus(row[5]),
            rejection_reason=row[6],
        )

    @staticmethod
    def _staff_member_record(row: Any) -> StaffMemberRecord:
        return StaffMemberRecord(
            user_id=row[0],
            email=row[1],
            name=row[2],
            phone=row[3],
            role=StaffRole(row[4]),
        )
