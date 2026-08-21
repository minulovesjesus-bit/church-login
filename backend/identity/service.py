from datetime import date
from uuid import UUID

from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.repository import IdentityRepository
from backend.identity.schemas import StudentProfileInput, StudentProfileView

EMAIL_NOT_VERIFIED = (
    "EMAIL_NOT_VERIFIED",
    "이메일 인증을 완료한 뒤 학생 정보를 등록해 주세요.",
    403,
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
