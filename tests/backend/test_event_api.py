from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import httpx

from backend.core.auth import get_current_user
from backend.core.errors import ApiError
from backend.events.models import EventOccurrence, EventSeries
from backend.events.recurrence import SEOUL
from backend.events.router import get_event_service
from backend.events.schemas import EventCreate, EventUpdate
from backend.events.service import EventService
from backend.identity.models import AuthenticatedUser
from backend.identity.router import require_teacher
from backend.main import app


class FakeEventService:
    def __init__(self) -> None:
        self.series_id = UUID("00000000-0000-4000-8000-000000000001")
        self.created_by = UUID("00000000-0000-4000-8000-000000000002")

    async def occurrences(
        self, user: AuthenticatedUser, range_start: date, range_end: date
    ) -> list[EventOccurrence]:
        return [
            EventOccurrence(
                occurrence_id=f"{self.series_id}:2026-08-23",
                event_id=self.series_id,
                title=f"{user.email}:{range_start}:{range_end}",
                description=None,
                local_start=datetime(2026, 8, 23, 11, tzinfo=SEOUL),
                local_end=datetime(2026, 8, 23, 12, tzinfo=SEOUL),
                location="본당",
            )
        ]

    async def list_series(self, _actor: AuthenticatedUser) -> list[EventSeries]:
        return [self._series(title="주일예배")]

    async def create(
        self, command: EventCreate, actor: AuthenticatedUser
    ) -> EventSeries:
        return self._series(
            title=command.title,
            description=command.description,
            location=command.location,
            starts_at=command.starts_at,
            ends_at=command.ends_at,
            repeat_weekly=command.repeat_weekly,
            repeat_until=command.repeat_until,
            created_by=actor.user_id,
        )

    async def update(
        self, event_id: UUID, command: EventUpdate, actor: AuthenticatedUser
    ) -> EventSeries:
        if event_id != self.series_id:
            raise ApiError("EVENT_NOT_FOUND", "행사 정보를 찾을 수 없습니다.", 404)
        return await self.create(EventCreate(**command.model_dump()), actor)

    async def delete(self, event_id: UUID, _actor: AuthenticatedUser) -> None:
        if event_id != self.series_id:
            raise ApiError("EVENT_NOT_FOUND", "행사 정보를 찾을 수 없습니다.", 404)

    def _series(
        self,
        *,
        title: str,
        description: str | None = None,
        location: str | None = None,
        starts_at: datetime = datetime(2026, 8, 23, 2, tzinfo=UTC),
        ends_at: datetime = datetime(2026, 8, 23, 3, tzinfo=UTC),
        repeat_weekly: bool = False,
        repeat_until: date | None = None,
        created_by: UUID | None = None,
    ) -> EventSeries:
        return EventSeries(
            id=self.series_id,
            title=title,
            description=description,
            location=location,
            starts_at=starts_at,
            ends_at=ends_at,
            repeat_weekly=repeat_weekly,
            repeat_until=repeat_until,
            created_by=created_by or self.created_by,
            created_at=datetime(2026, 8, 21, tzinfo=UTC),
            updated_at=datetime(2026, 8, 21, tzinfo=UTC),
        )


def user(*, teacher: bool = False) -> AuthenticatedUser:
    return AuthenticatedUser(
        user_id=uuid4(),
        email="teacher@example.com" if teacher else "student@example.com",
        provider="google" if teacher else "password",
        email_verified=True,
    )


async def test_event_occurrences_require_auth_and_accept_only_from_to_aliases(
    client: httpx.AsyncClient,
) -> None:
    service = FakeEventService()
    student = user()
    app.dependency_overrides[get_event_service] = lambda: service
    try:
        unauthenticated = await client.get(
            "/api/events?from=2026-08-17&to=2026-08-24"
        )

        async def current_student() -> AuthenticatedUser:
            return student

        app.dependency_overrides[get_current_user] = current_student
        response = await client.get("/api/events?from=2026-08-17&to=2026-08-24")
        wrong_aliases = await client.get(
            "/api/events?start=2026-08-17&end=2026-08-24"
        )
    finally:
        app.dependency_overrides.clear()

    assert unauthenticated.status_code == 401
    assert response.status_code == 200
    assert response.json()[0]["title"] == (
        "student@example.com:2026-08-17:2026-08-24"
    )
    assert response.json()[0]["local_start"].endswith("+09:00")
    assert wrong_aliases.status_code == 422
    assert wrong_aliases.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_event_range_is_real_exclusive_and_at_most_42_days(
    client: httpx.AsyncClient,
) -> None:
    student = user()
    app.dependency_overrides[get_current_user] = lambda: student
    app.dependency_overrides[get_event_service] = FakeEventService
    try:
        exact_limit = await client.get(
            "/api/events?from=2026-08-01&to=2026-09-12"
        )
        empty = await client.get("/api/events?from=2026-08-01&to=2026-08-01")
        too_long = await client.get(
            "/api/events?from=2026-08-01&to=2026-09-13"
        )
        impossible = await client.get(
            "/api/events?from=2026-02-30&to=2026-03-02"
        )
    finally:
        app.dependency_overrides.clear()

    assert exact_limit.status_code == 200
    assert empty.status_code == 422
    assert too_long.status_code == 422
    assert impossible.status_code == 422


async def test_teacher_create_normalizes_fields_and_rejects_browser_authority(
    client: httpx.AsyncClient,
) -> None:
    teacher = user(teacher=True)
    app.dependency_overrides[require_teacher] = lambda: teacher
    app.dependency_overrides[get_event_service] = FakeEventService
    payload = {
        "title": "  여름   수련회  ",
        "description": "  함께   출발합니다  ",
        "location": "  교육관   2층  ",
        "starts_at": "2026-08-23T11:00:00+09:00",
        "ends_at": "2026-08-23T13:00:00+09:00",
        "repeat_weekly": True,
        "repeat_until": "2026-09-06",
    }
    try:
        response = await client.post("/api/teacher/events", json=payload)
        injected = await client.post(
            "/api/teacher/events",
            json={**payload, "created_by": str(uuid4()), "role": "admin"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json()["title"] == "여름 수련회"
    assert response.json()["description"] == "함께 출발합니다"
    assert response.json()["location"] == "교육관 2층"
    assert response.json()["created_by"] == str(teacher.user_id)
    assert injected.status_code == 422


async def test_teacher_event_validation_rejects_unsafe_series_inputs(
    client: httpx.AsyncClient,
) -> None:
    teacher = user(teacher=True)
    app.dependency_overrides[require_teacher] = lambda: teacher
    app.dependency_overrides[get_event_service] = FakeEventService
    valid = {
        "title": "주일예배",
        "starts_at": "2026-08-23T11:00:00+09:00",
        "ends_at": "2026-08-23T12:00:00+09:00",
        "repeat_weekly": False,
        "repeat_until": None,
    }
    try:
        naive = await client.post(
            "/api/teacher/events",
            json={**valid, "starts_at": "2026-08-23T11:00:00"},
        )
        backwards = await client.post(
            "/api/teacher/events",
            json={**valid, "ends_at": "2026-08-23T10:00:00+09:00"},
        )
        one_time_with_end = await client.post(
            "/api/teacher/events",
            json={**valid, "repeat_until": "2026-09-06"},
        )
        weekly_before_first = await client.post(
            "/api/teacher/events",
            json={
                **valid,
                "repeat_weekly": True,
                "repeat_until": "2026-08-22",
            },
        )
        oversized = await client.post(
            "/api/teacher/events", json={**valid, "title": "가" * 121}
        )
    finally:
        app.dependency_overrides.clear()

    assert {
        naive.status_code,
        backwards.status_code,
        one_time_with_end.status_code,
        weekly_before_first.status_code,
        oversized.status_code,
    } == {422}


async def test_teacher_can_list_update_and_delete_only_whole_series(
    client: httpx.AsyncClient,
) -> None:
    teacher = user(teacher=True)
    service = FakeEventService()
    app.dependency_overrides[require_teacher] = lambda: teacher
    app.dependency_overrides[get_event_service] = lambda: service
    update = {
        "title": "수정 예배",
        "description": None,
        "location": "본당",
        "starts_at": "2026-08-30T11:00:00+09:00",
        "ends_at": "2026-08-30T12:00:00+09:00",
        "repeat_weekly": True,
        "repeat_until": None,
    }
    try:
        listed = await client.get("/api/teacher/events")
        updated = await client.patch(
            f"/api/teacher/events/{service.series_id}", json=update
        )
        deleted = await client.delete(
            f"/api/teacher/events/{service.series_id}"
        )
        missing = await client.delete(f"/api/teacher/events/{uuid4()}")
    finally:
        app.dependency_overrides.clear()

    assert listed.status_code == 200
    assert listed.json()[0]["id"] == str(service.series_id)
    assert updated.status_code == 200
    assert updated.json()["title"] == "수정 예배"
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "EVENT_NOT_FOUND"
    assert missing.json()["error"]["message"] == "행사 정보를 찾을 수 없습니다."


async def test_event_response_waits_for_function_scoped_transaction(
    client: httpx.AsyncClient,
) -> None:
    student = user()
    service = FakeEventService()

    async def failing_transaction_service():
        yield service
        raise ApiError("DATABASE_UNAVAILABLE", "잠시 후 다시 시도해 주세요.", 503)

    app.dependency_overrides[get_current_user] = lambda: student
    app.dependency_overrides[get_event_service] = failing_transaction_service
    try:
        response = await client.get("/api/events?from=2026-08-17&to=2026-08-24")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"


class FakeEventRepository:
    def __init__(self) -> None:
        self.completed_identity = True
        self.staff_role: str | None = "teacher"
        self.series: list[EventSeries] = []
        self.saved: EventSeries | None = None

    async def has_completed_student_identity(self, _user_id: UUID) -> bool:
        return self.completed_identity

    async def active_staff_role(self, _user_id: UUID) -> str | None:
        return self.staff_role

    async def candidate_series(
        self, _range_start: date, _range_end: date
    ) -> list[EventSeries]:
        return self.series

    async def list_series(self) -> list[EventSeries]:
        return self.series

    async def create(self, command: EventCreate, actor_id: UUID) -> EventSeries:
        self.saved = FakeEventService()._series(
            title=command.title,
            description=command.description,
            location=command.location,
            starts_at=command.starts_at,
            ends_at=command.ends_at,
            repeat_weekly=command.repeat_weekly,
            repeat_until=command.repeat_until,
            created_by=actor_id,
        )
        return self.saved

    async def update(
        self, _event_id: UUID, _command: EventUpdate, _actor_id: UUID
    ) -> EventSeries | None:
        return self.saved

    async def delete(self, _event_id: UUID, _actor_id: UUID) -> bool:
        return self.saved is not None


async def test_event_service_requires_completed_student_identity() -> None:
    repository = FakeEventRepository()
    repository.completed_identity = False
    service = EventService(repository)

    try:
        await service.occurrences(user(), date(2026, 8, 17), date(2026, 8, 24))
    except ApiError as error:
        assert (error.code, error.message, error.status_code) == (
            "PROFILE_REQUIRED",
            "학생 정보를 먼저 등록해 주세요.",
            403,
        )
    else:
        raise AssertionError("Incomplete student identity must be rejected")


async def test_event_service_sorts_occurrences_deterministically() -> None:
    repository = FakeEventRepository()
    first_id = UUID("00000000-0000-4000-8000-000000000001")
    second_id = UUID("00000000-0000-4000-8000-000000000002")
    base = FakeEventService()
    repository.series = [
        EventSeries(
            **{
                **base._series(title="나중 ID").__dict__,
                "id": second_id,
            }
        ),
        EventSeries(
            **{
                **base._series(title="먼저 ID").__dict__,
                "id": first_id,
            }
        ),
    ]

    occurrences = await EventService(repository).occurrences(
        user(), date(2026, 8, 23), date(2026, 8, 24)
    )

    assert [item.event_id for item in occurrences] == [first_id, second_id]


async def test_event_service_rechecks_active_staff_before_mutation_or_lookup() -> None:
    repository = FakeEventRepository()
    repository.staff_role = None
    service = EventService(repository)
    command = EventCreate(
        title="주일예배",
        starts_at=datetime(2026, 8, 23, 2, tzinfo=UTC),
        ends_at=datetime(2026, 8, 23, 3, tzinfo=UTC),
        repeat_weekly=False,
    )

    for operation in (
        service.list_series(user(teacher=True)),
        service.create(command, user(teacher=True)),
        service.update(uuid4(), EventUpdate(**command.model_dump()), user(teacher=True)),
        service.delete(uuid4(), user(teacher=True)),
    ):
        try:
            await operation
        except ApiError as error:
            assert (error.code, error.status_code) == ("FORBIDDEN", 403)
        else:
            raise AssertionError("Inactive staff membership must be rejected")


async def test_event_service_uses_same_safe_404_for_missing_update_and_delete() -> None:
    repository = FakeEventRepository()
    service = EventService(repository)
    command = EventUpdate(
        title="주일예배",
        starts_at=datetime(2026, 8, 23, 2, tzinfo=UTC),
        ends_at=datetime(2026, 8, 23, 3, tzinfo=UTC),
        repeat_weekly=False,
    )

    for operation in (
        service.update(uuid4(), command, user(teacher=True)),
        service.delete(uuid4(), user(teacher=True)),
    ):
        try:
            await operation
        except ApiError as error:
            assert (error.code, error.message, error.status_code) == (
                "EVENT_NOT_FOUND",
                "행사 정보를 찾을 수 없습니다.",
                404,
            )
        else:
            raise AssertionError("Missing event must return the safe 404")
