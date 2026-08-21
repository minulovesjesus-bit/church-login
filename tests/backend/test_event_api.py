import os
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import psycopg
import pytest
from psycopg.types.json import Jsonb

from backend.core.auth import get_current_user
from backend.core.config import settings
from backend.core.errors import ApiError
from backend.events.models import EventOccurrence, EventSeries
from backend.events.recurrence import SEOUL
from backend.events.router import get_event_service
from backend.events.schemas import (
    EventCreate,
    EventSeriesFilters,
    EventSeriesPage,
    EventUpdate,
)
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

    async def list_series(
        self, _actor: AuthenticatedUser, filters: EventSeriesFilters
    ) -> EventSeriesPage:
        return EventSeriesPage(
            items=[self._series(title="주일예배")],
            total=1,
            page=filters.page,
            page_size=filters.page_size,
        )

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


async def test_teacher_event_duration_accepts_seven_days_and_rejects_one_second_more(
    client: httpx.AsyncClient,
) -> None:
    teacher = user(teacher=True)
    app.dependency_overrides[require_teacher] = lambda: teacher
    app.dependency_overrides[get_event_service] = FakeEventService
    payload = {
        "title": "수련회",
        "starts_at": "2026-08-23T11:00:00+09:00",
        "ends_at": "2026-08-30T11:00:00+09:00",
        "repeat_weekly": False,
    }
    try:
        boundary = await client.post("/api/teacher/events", json=payload)
        too_long = await client.post(
            "/api/teacher/events",
            json={**payload, "ends_at": "2026-08-30T11:00:01+09:00"},
        )
    finally:
        app.dependency_overrides.clear()

    assert boundary.status_code == 201
    assert too_long.status_code == 422
    assert too_long.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_event_service_revalidates_duration_before_repository_mutation() -> None:
    repository = FakeEventRepository()
    starts_at = datetime(2026, 8, 23, 2, tzinfo=UTC)
    command = EventCreate.model_construct(
        title="수련회",
        description=None,
        location=None,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(days=7, seconds=1),
        repeat_weekly=False,
        repeat_until=None,
    )

    try:
        await EventService(repository).create(command, user(teacher=True))
    except ApiError as error:
        assert (error.code, error.message, error.status_code) == (
            "VALIDATION_ERROR",
            "입력값을 확인해 주세요.",
            422,
        )
    else:
        raise AssertionError("Service must reject event durations over seven days")


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
        listed = await client.get("/api/teacher/events?page=1&page_size=100")
        invalid_page_size = await client.get(
            "/api/teacher/events?page=1&page_size=101"
        )
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
    assert listed.json()["items"][0]["id"] == str(service.series_id)
    assert listed.json()["total"] == 1
    assert listed.json()["page"] == 1
    assert listed.json()["page_size"] == 100
    assert invalid_page_size.status_code == 422
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


async def test_initial_admin_first_event_request_bootstraps_and_commits_atomically(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = os.environ["TEST_DATABASE_URL"]
    admin_id = uuid4()
    admin_email = "first-event-admin@example.com"
    with psycopg.connect(database_url) as connection:
        existing_markers = connection.execute(
            """
            select id, actor_id, action, target_type, target_id, details, created_at
            from app.audit_logs
            where action = 'staff.bootstrap_admin'
              and target_type = 'staff_membership'
            """
        ).fetchall()
        connection.execute(
            """
            delete from app.audit_logs
            where action = 'staff.bootstrap_admin'
              and target_type = 'staff_membership'
            """
        )
        connection.execute("insert into auth.users (id) values (%s)", (admin_id,))

    initial_admin = AuthenticatedUser(
        user_id=admin_id,
        email=admin_email,
        provider="google",
        email_verified=True,
    )
    monkeypatch.setattr(settings, "initial_admin_email", admin_email)
    app.dependency_overrides[get_current_user] = lambda: initial_admin
    try:
        response = await client.post(
            "/api/teacher/events",
            json={
                "title": "첫 관리자 행사",
                "starts_at": "2026-08-23T11:00:00+09:00",
                "ends_at": "2026-08-23T12:00:00+09:00",
                "repeat_weekly": False,
            },
        )
        with psycopg.connect(database_url) as connection:
            membership = connection.execute(
                "select role::text from app.staff_memberships where user_id = %s",
                (admin_id,),
            ).fetchone()
            event_row = connection.execute(
                """
                select id, title, created_by
                from app.events
                where created_by = %s
                """,
                (admin_id,),
            ).fetchone()
            actions = {
                row[0]
                for row in connection.execute(
                    "select action from app.audit_logs where actor_id = %s",
                    (admin_id,),
                ).fetchall()
            }
    finally:
        app.dependency_overrides.clear()
        with psycopg.connect(database_url) as connection:
            connection.execute(
                "delete from app.audit_logs where actor_id = %s", (admin_id,)
            )
            connection.execute(
                "delete from app.events where created_by = %s", (admin_id,)
            )
            connection.execute(
                "delete from app.staff_memberships where user_id = %s", (admin_id,)
            )
            connection.execute(
                "delete from app.user_profiles where user_id = %s", (admin_id,)
            )
            connection.execute("delete from auth.users where id = %s", (admin_id,))
            for marker in existing_markers:
                connection.execute(
                    """
                    insert into app.audit_logs (
                      id, actor_id, action, target_type, target_id, details, created_at
                    ) values (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (*marker[:5], Jsonb(marker[5]), marker[6]),
                )

    assert response.status_code == 201
    assert membership == ("admin",)
    assert event_row is not None
    assert event_row[1:] == ("첫 관리자 행사", admin_id)
    assert actions == {"staff.bootstrap_admin", "event.created"}


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

    async def list_series(self, filters: EventSeriesFilters) -> EventSeriesPage:
        return EventSeriesPage(
            items=self.series,
            total=len(self.series),
            page=filters.page,
            page_size=filters.page_size,
        )

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
        service.list_series(user(teacher=True), EventSeriesFilters()),
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


async def test_candidate_cap_is_checked_before_recurrence_expansion() -> None:
    repository = FakeEventRepository()
    valid = FakeEventService()._series(title="후보")
    invalid_first = replace(valid, starts_at=valid.starts_at.replace(tzinfo=None))
    repository.series = [invalid_first, *([valid] * 1000)]

    try:
        await EventService(repository).occurrences(
            user(), date(2026, 8, 17), date(2026, 9, 28)
        )
    except ApiError as error:
        assert (error.code, error.message, error.status_code) == (
            "EVENT_RESULT_TOO_LARGE",
            "조회할 행사가 너무 많습니다. 조회 기간을 줄여 주세요.",
            422,
        )
    else:
        raise AssertionError("Candidate cap must reject cap plus one rows")


async def test_occurrence_output_allows_cap_and_rejects_cap_plus_one() -> None:
    base = FakeEventService()._series(title="행사")
    repository = FakeEventRepository()
    repository.series = [
        replace(base, id=UUID(int=index + 1)) for index in range(1000)
    ]
    at_cap = await EventService(repository).occurrences(
        user(), date(2026, 8, 23), date(2026, 8, 24)
    )
    assert len(at_cap) == 1000

    weekly = replace(base, repeat_weekly=True)
    repository.series = [
        replace(weekly, id=UUID(int=index + 1)) for index in range(168)
    ]
    try:
        await EventService(repository).occurrences(
            user(), date(2026, 8, 17), date(2026, 9, 28)
        )
    except ApiError as error:
        assert (error.code, error.message, error.status_code) == (
            "EVENT_RESULT_TOO_LARGE",
            "조회할 행사가 너무 많습니다. 조회 기간을 줄여 주세요.",
            422,
        )
    else:
        raise AssertionError("Occurrence cap must reject cap plus one rows")
