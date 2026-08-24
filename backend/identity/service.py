from datetime import date
from uuid import UUID

from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.repository import IdentityRepository
from backend.identity.schemas import (
    RejectTeacherApplicationInput,
    StaffMemberView,
    StaffRole,
    StudentProfileInput,
    StudentProfileView,
    TeacherApplicationInput,
    TeacherApplicationStateView,
    TeacherApplicationStatus,
    TeacherApplicationView,
)

EMAIL_NOT_VERIFIED = (
    "EMAIL_NOT_VERIFIED",
    "이메일 인증을 완료한 뒤 학생 정보를 등록해 주세요.",
    403,
)
GOOGLE_AUTH_REQUIRED = (
    "GOOGLE_AUTH_REQUIRED",
    "교사 기능은 Google 계정으로 로그인해야 합니다.",
    403,
)
FORBIDDEN = ("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403)
PROFILE_REQUIRED = ("PROFILE_REQUIRED", "학생 정보를 먼저 등록해 주세요.", 403)


class LastAdminProtected(ApiError):
    def __init__(self) -> None:
        super().__init__(
            "LAST_ADMIN_PROTECTED",
            "마지막 관리자는 교사로 변경할 수 없습니다.",
            409,
        )


class IdentityService:
    def __init__(self, repository: IdentityRepository) -> None:
        self._repository = repository

    async def upsert_student_profile(
        self,
        user: AuthenticatedUser,
        *,
        name: str,
        birth_date: date,
        phone: str,
        guardian_phone: str,
    ) -> StudentProfileView:
        if user.provider != "google" and not user.email_verified:
            raise ApiError(*EMAIL_NOT_VERIFIED)

        profile_input = StudentProfileInput(
            name=name,
            birth_date=birth_date,
            phone=phone,
            guardian_phone=guardian_phone,
        )
        profile = await self._repository.upsert_student_profile(
            user,
            **profile_input.model_dump(),
        )
        return StudentProfileView(
            name=profile.name,
            birth_date=profile.birth_date,
            phone=profile.phone,
            guardian_phone=profile.guardian_phone,
            include_in_statistics=profile.include_in_statistics,
        )

    async def current_student_profile(
        self, user: AuthenticatedUser
    ) -> StudentProfileView:
        profile = await self._repository.student_profile(user.user_id)
        if profile is None:
            raise ApiError(*PROFILE_REQUIRED)
        return StudentProfileView(
            name=profile.name,
            birth_date=profile.birth_date,
            phone=profile.phone,
            guardian_phone=profile.guardian_phone,
            include_in_statistics=profile.include_in_statistics,
        )

    async def current_identity(self, user: AuthenticatedUser) -> dict[str, object]:
        state = await self._repository.identity_state(user.user_id)
        staff_role = state.staff_role
        return {
            "user_id": str(user.user_id),
            "email": user.email,
            "provider": user.provider,
            "email_verified": user.email_verified,
            "onboarding_completed": state.onboarding_completed,
            "capabilities": {
                "student": state.onboarding_completed,
                "teacher": staff_role in {"teacher", "admin"},
                "admin": staff_role == "admin",
            },
        }

    async def student_profile_belongs_to(self, user_id: UUID) -> bool:
        return (await self._repository.identity_state(user_id)).onboarding_completed


class StaffService:
    def __init__(
        self, repository: IdentityRepository, *, initial_admin_email: str | None = None
    ) -> None:
        self._repository = repository
        self._initial_admin_email = initial_admin_email

    async def apply(
        self,
        user: AuthenticatedUser,
        *,
        name: str,
        phone: str,
    ) -> TeacherApplicationView:
        if user.provider != "google":
            raise ApiError(*GOOGLE_AUTH_REQUIRED)
        application_input = TeacherApplicationInput(name=name, phone=phone)
        existing_role = await self._repository.staff_role(user.user_id)
        if existing_role in {StaffRole.TEACHER, StaffRole.ADMIN}:
            current = await self._repository.teacher_application_state(user.user_id)
            if current is not None:
                return self._application_view(current, status=TeacherApplicationStatus.APPROVED)
            raise ApiError("ALREADY_STAFF", "이미 교사 권한이 있습니다.", 409)
        application = await self._repository.create_or_get_teacher_application(
            user, **application_input.model_dump()
        )
        return self._application_view(application)

    async def application_state(
        self, user: AuthenticatedUser
    ) -> TeacherApplicationStateView:
        if user.provider != "google":
            raise ApiError(*GOOGLE_AUTH_REQUIRED)
        if await self.has_teacher_access(user.user_id):
            return TeacherApplicationStateView(status=TeacherApplicationStatus.APPROVED)
        application = await self._repository.teacher_application_state(user.user_id)
        if application is None:
            return TeacherApplicationStateView(status=TeacherApplicationStatus.NONE)
        return TeacherApplicationStateView(
            status=application.status,
            rejection_reason=application.rejection_reason,
        )

    async def has_teacher_access(self, user_id: UUID) -> bool:
        return await self._repository.staff_role(user_id) in {
            StaffRole.TEACHER,
            StaffRole.ADMIN,
        }

    async def bootstrap_initial_admin(self, user: AuthenticatedUser) -> bool:
        if (
            not self._initial_admin_email
            or user.provider != "google"
            or not user.email_verified
            or user.email != self._initial_admin_email
        ):
            return False
        return await self._repository.bootstrap_initial_admin(user)

    async def decide_application(
        self,
        actor_id: UUID,
        application_id: UUID,
        *,
        decision: str,
        rejection_reason: str | None = None,
    ) -> TeacherApplicationView:
        await self._locked_memberships_for_admin(actor_id)
        try:
            status = TeacherApplicationStatus(decision)
        except ValueError:
            raise ApiError("INVALID_DECISION", "올바른 처리 상태를 선택해 주세요.", 422) from None
        if status not in {
            TeacherApplicationStatus.APPROVED,
            TeacherApplicationStatus.REJECTED,
        }:
            raise ApiError("INVALID_DECISION", "올바른 처리 상태를 선택해 주세요.", 422)
        if status == TeacherApplicationStatus.REJECTED:
            rejected = RejectTeacherApplicationInput(
                rejection_reason=rejection_reason or ""
            )
            rejection_reason = rejected.rejection_reason
        elif rejection_reason is not None:
            raise ApiError(
                "INVALID_DECISION",
                "승인 처리에는 거절 사유를 입력할 수 없습니다.",
                422,
            )
        application = await self._repository.decide_teacher_application(
            actor_id,
            application_id,
            decision=status,
            rejection_reason=rejection_reason,
        )
        return self._application_view(application)

    async def pending_applications(self) -> list[TeacherApplicationView]:
        return [
            self._application_view(application)
            for application in await self._repository.list_pending_teacher_applications()
        ]

    async def staff_members(self) -> list[StaffMemberView]:
        return [
            StaffMemberView.model_validate(member, from_attributes=True)
            for member in await self._repository.list_staff()
        ]

    async def set_role(
        self, actor_id: UUID, target_user_id: UUID, role: str
    ) -> StaffMemberView:
        try:
            requested_role = StaffRole(role)
        except ValueError:
            raise ApiError("INVALID_ROLE", "올바른 역할을 선택해 주세요.", 422) from None

        locked_memberships = await self._locked_memberships_for_admin(actor_id)
        current_role = next(
            (
                current
                for member_id, current in locked_memberships
                if member_id == target_user_id
            ),
            None,
        )
        if current_role is None:
            raise ApiError("STAFF_NOT_FOUND", "교직원 정보를 찾을 수 없습니다.", 404)
        current_member = await self._repository.staff_member(target_user_id)
        if current_member is None:
            raise ApiError("STAFF_NOT_FOUND", "교직원 정보를 찾을 수 없습니다.", 404)
        if current_role == requested_role:
            return StaffMemberView.model_validate(current_member, from_attributes=True)
        if current_role == StaffRole.ADMIN and requested_role == StaffRole.TEACHER:
            admin_count = sum(
                member_role == StaffRole.ADMIN
                for _, member_role in locked_memberships
            )
            if admin_count <= 1:
                raise LastAdminProtected()
        changed = await self._repository.update_staff_role(
            actor_id, target_user_id, requested_role
        )
        return StaffMemberView.model_validate(changed, from_attributes=True)

    async def _locked_memberships_for_admin(
        self, actor_id: UUID
    ) -> list[tuple[UUID, StaffRole]]:
        locked_memberships = await self._repository.lock_staff_memberships()
        actor_role = next(
            (
                role
                for member_id, role in locked_memberships
                if member_id == actor_id
            ),
            None,
        )
        if actor_role != StaffRole.ADMIN:
            raise ApiError(*FORBIDDEN)
        return locked_memberships

    @staticmethod
    def _application_view(
        application: object,
        *,
        status: TeacherApplicationStatus | None = None,
    ) -> TeacherApplicationView:
        view = TeacherApplicationView.model_validate(application, from_attributes=True)
        return view.model_copy(update={"status": status}) if status is not None else view
