import base64
import binascii
import hashlib
import json
from typing import Any
from uuid import UUID

from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.students.repository import StudentCursorKey, StudentRepository
from backend.students.schemas import (
    StudentListFilters,
    TeacherStudentPage,
    TeacherStudentUpdate,
    TeacherStudentView,
)

INVALID_CURSOR = ("INVALID_CURSOR", "페이지 위치를 확인해 주세요.", 422)
STUDENT_NOT_FOUND = ("STUDENT_NOT_FOUND", "학생 정보를 찾을 수 없습니다.", 404)
STUDENT_STAFF_ROLE_CONFLICT = (
    "STUDENT_STAFF_ROLE_CONFLICT",
    "관리자 권한이 있는 학생은 교사로 승격할 수 없습니다.",
    409,
)
FORBIDDEN = ("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403)
CURSOR_VERSION = 1
CURSOR_FIELDS = {"v", "q", "s", "n", "i"}
CURSOR_DIGEST_LENGTH = 64
CURSOR_NAME_MAX_LENGTH = 80
CURSOR_ID_LENGTH = 36
HEX_DIGITS = frozenset("0123456789abcdef")


class StudentService:
    def __init__(self, repository: StudentRepository) -> None:
        self._repository = repository

    async def list_students(
        self,
        actor: AuthenticatedUser,
        filters: StudentListFilters,
    ) -> TeacherStudentPage:
        actor_role = await self._require_active_staff(actor.user_id)
        cursor_key = self._decode_cursor(filters)
        candidates = await self._repository.list_students(filters, cursor_key)
        items = candidates[: filters.page_size]
        next_cursor = None
        if len(candidates) > filters.page_size and items:
            last = items[-1]
            next_cursor = self._encode_cursor(filters, last)
        return TeacherStudentPage(
            items=items,
            next_cursor=next_cursor,
            page_size=filters.page_size,
            can_promote=actor_role == "admin",
        )

    async def update_student(
        self,
        actor: AuthenticatedUser,
        student_id: UUID,
        command: TeacherStudentUpdate,
    ) -> TeacherStudentView:
        await self._require_active_staff(actor.user_id)
        updated = await self._repository.update_student(
            student_id,
            command,
            actor.user_id,
        )
        if updated is None:
            raise ApiError(*STUDENT_NOT_FOUND)
        return updated

    async def promote_student_to_teacher(
        self,
        actor: AuthenticatedUser,
        student_id: UUID,
    ) -> TeacherStudentView:
        await self._repository.serialize_staff_memberships()
        if await self._repository.active_staff_role(actor.user_id) != "admin":
            raise ApiError(*FORBIDDEN)

        current = await self._repository.get_student(student_id)
        if current is None:
            raise ApiError(*STUDENT_NOT_FOUND)
        if current.staff_role == "admin":
            raise ApiError(*STUDENT_STAFF_ROLE_CONFLICT)
        if current.staff_role == "teacher":
            return current

        await self._repository.promote_student_to_teacher(student_id, actor.user_id)
        refreshed = await self._repository.get_student(student_id)
        if refreshed is None:
            raise ApiError(*STUDENT_NOT_FOUND)
        if refreshed.staff_role == "admin":
            raise ApiError(*STUDENT_STAFF_ROLE_CONFLICT)
        if refreshed.staff_role != "teacher":
            raise RuntimeError("Student promotion returned without a staff membership")
        return refreshed

    async def _require_active_staff(self, user_id: UUID) -> str:
        role = await self._repository.active_staff_role(user_id)
        if role not in {"teacher", "admin"}:
            raise ApiError(*FORBIDDEN)
        return role

    @staticmethod
    def _filter_digest(query: str | None) -> str:
        return hashlib.sha256((query or "").encode("utf-8")).hexdigest()

    def _encode_cursor(
        self,
        filters: StudentListFilters,
        student: TeacherStudentView,
    ) -> str:
        payload = {
            "v": CURSOR_VERSION,
            "q": self._filter_digest(filters.query),
            "s": filters.statistics.value,
            "n": student.name,
            "i": str(student.user_id),
        }
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ).decode("ascii")
        return encoded.rstrip("=")

    def _decode_cursor(self, filters: StudentListFilters) -> StudentCursorKey | None:
        if filters.cursor is None:
            return None
        try:
            padding = "=" * (-len(filters.cursor) % 4)
            raw = base64.b64decode(
                filters.cursor + padding,
                altchars=b"-_",
                validate=True,
            )
            if len(raw) > 512:
                raise ValueError("cursor payload is too large")
            payload: Any = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict) or set(payload) != CURSOR_FIELDS:
                raise ValueError("cursor shape is invalid")

            version = payload["v"]
            filter_digest = payload["q"]
            statistics = payload["s"]
            cursor_name = payload["n"]
            cursor_id = payload["i"]

            if (
                type(version) is not int
                or version != CURSOR_VERSION
                or not isinstance(filter_digest, str)
                or len(filter_digest) != CURSOR_DIGEST_LENGTH
                or any(character not in HEX_DIGITS for character in filter_digest)
                or not isinstance(statistics, str)
                or statistics not in {"all", "included", "excluded"}
                or not isinstance(cursor_name, str)
                or not 1 <= len(cursor_name) <= CURSOR_NAME_MAX_LENGTH
                or not isinstance(cursor_id, str)
                or len(cursor_id) != CURSOR_ID_LENGTH
            ):
                raise ValueError("cursor fields are invalid")

            user_id = UUID(cursor_id)
            if str(user_id) != cursor_id:
                raise ValueError("cursor id is not canonical")
            if (
                filter_digest != self._filter_digest(filters.query)
                or statistics != filters.statistics.value
            ):
                raise ValueError("cursor filters do not match")

            return StudentCursorKey(
                name=cursor_name,
                user_id=user_id,
            )
        except (
            binascii.Error,
            json.JSONDecodeError,
            UnicodeDecodeError,
            TypeError,
            ValueError,
        ):
            raise ApiError(*INVALID_CURSOR) from None
