import os
from collections.abc import Iterator
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.errors import CheckViolation, InsufficientPrivilege

from backend.core.db import application_transaction
from backend.events.repository import EventRepository
from backend.events.schemas import EventCreate, EventUpdate
from backend.events.service import EventService
from backend.identity.models import AuthenticatedUser


@pytest.fixture
def event_connection() -> Iterator[psycopg.Connection[tuple[Any, ...]]]:
    connection = psycopg.connect(os.environ["TEST_DATABASE_URL"])
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


def _seed_user(
    connection: psycopg.Connection[tuple[Any, ...]], user_id: UUID, email: str
) -> None:
    connection.execute("insert into auth.users (id) values (%s)", (user_id,))
    connection.execute(
        """
        insert into app.user_profiles (user_id, email, name)
        values (%s, %s, '행사 스키마 테스트')
        """,
        (user_id, email),
    )


def _seed_teacher(
    connection: psycopg.Connection[tuple[Any, ...]], teacher_id: UUID
) -> None:
    _seed_user(connection, teacher_id, f"{teacher_id}@teacher.example.com")
    connection.execute(
        "insert into app.staff_memberships (user_id, role) values (%s, 'teacher')",
        (teacher_id,),
    )


def test_event_table_has_exact_columns_and_constraints(
    event_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    rows = event_connection.execute(
        """
        select column_name, udt_name, is_nullable, column_default
        from information_schema.columns
        where table_schema = 'app' and table_name = 'events'
        order by ordinal_position
        """
    ).fetchall()

    assert rows == [
        ("id", "uuid", "NO", "gen_random_uuid()"),
        ("title", "text", "NO", None),
        ("description", "text", "YES", None),
        ("location", "text", "YES", None),
        ("starts_at", "timestamptz", "NO", None),
        ("ends_at", "timestamptz", "NO", None),
        ("repeat_weekly", "bool", "NO", "false"),
        ("repeat_until", "date", "YES", None),
        ("created_by", "uuid", "NO", None),
        ("created_at", "timestamptz", "NO", "now()"),
        ("updated_at", "timestamptz", "NO", "now()"),
    ]

    constraints = dict(
        event_connection.execute(
            """
            select con.conname, pg_get_constraintdef(con.oid)
            from pg_constraint con
            join pg_class rel on rel.oid = con.conrelid
            join pg_namespace nsp on nsp.oid = rel.relnamespace
            where nsp.nspname = 'app' and rel.relname = 'events'
            """
        ).fetchall()
    )
    assert constraints["events_title_length"] == (
        "CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 120)))"
    )
    assert constraints["events_positive_duration"] == "CHECK ((ends_at > starts_at))"
    assert constraints["events_repeat_until_weekly"] == (
        "CHECK ((repeat_weekly OR (repeat_until IS NULL)))"
    )


def test_event_constraints_reject_invalid_rows(
    event_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    teacher_id = uuid4()
    _seed_teacher(event_connection, teacher_id)
    base_values = (
        "주일예배",
        datetime(2026, 8, 23, 2, tzinfo=UTC),
        datetime(2026, 8, 23, 3, tzinfo=UTC),
        False,
        None,
        teacher_id,
    )

    for values in (
        ("   ", *base_values[1:]),
        ("가" * 121, *base_values[1:]),
        (
            base_values[0],
            base_values[2],
            base_values[1],
            *base_values[3:],
        ),
        (*base_values[:4], date(2026, 9, 6), teacher_id),
    ):
        with pytest.raises(CheckViolation), event_connection.transaction():
            event_connection.execute(
                """
                insert into app.events (
                  title, starts_at, ends_at, repeat_weekly,
                  repeat_until, created_by
                ) values (%s, %s, %s, %s, %s, %s)
                """,
                values,
            )


def test_event_indexes_support_candidate_series_queries(
    event_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    rows = set(
        event_connection.execute(
            """
            select idx.relname, pg_get_expr(ind.indpred, ind.indrelid)
            from pg_index ind
            join pg_class idx on idx.oid = ind.indexrelid
            join pg_class tbl on tbl.oid = ind.indrelid
            join pg_namespace nsp on nsp.oid = tbl.relnamespace
            where nsp.nspname = 'app'
              and idx.relname like 'events_%_idx'
            """
        ).fetchall()
    )

    assert rows == {
        ("events_created_by_idx", None),
        ("events_starts_at_idx", None),
        ("events_one_time_ends_at_idx", "(NOT repeat_weekly)"),
        ("events_weekly_repeat_until_idx", "repeat_weekly"),
    }


def test_events_have_backend_only_crud_grants_and_rls(
    event_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    grants = set(
        event_connection.execute(
            """
            select grantee, privilege_type
            from information_schema.role_table_grants
            where table_schema = 'app' and table_name = 'events'
              and grantee in ('app_backend', 'anon', 'authenticated')
            """
        ).fetchall()
    )
    rls_enabled = event_connection.execute(
        """
        select relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relname = 'events'
        """
    ).fetchone()
    policies = event_connection.execute(
        """
        select cmd, roles::text, qual, with_check
        from pg_policies
        where schemaname = 'app' and tablename = 'events'
        """
    ).fetchall()

    assert grants == {
        ("app_backend", "SELECT"),
        ("app_backend", "INSERT"),
        ("app_backend", "UPDATE"),
        ("app_backend", "DELETE"),
    }
    assert rls_enabled == (True,)
    assert policies == [("ALL", "{app_backend}", "true", "true")]


@pytest.mark.parametrize("browser_role", ["anon", "authenticated"])
def test_browser_roles_cannot_read_events(
    event_connection: psycopg.Connection[tuple[Any, ...]], browser_role: str
) -> None:
    event_connection.execute(
        sql.SQL("set local role {}").format(sql.Identifier(browser_role))
    )
    with pytest.raises(InsufficientPrivilege):
        event_connection.execute("select * from app.events")


async def test_repository_crud_audits_only_metadata_and_prefilters_candidates() -> None:
    database_url = os.environ["TEST_DATABASE_URL"]
    teacher_id = uuid4()
    student_id = uuid4()
    with psycopg.connect(database_url) as connection:
        _seed_teacher(connection, teacher_id)
        _seed_user(connection, student_id, f"{student_id}@student.example.com")
        connection.execute(
            """
            insert into app.student_profiles (user_id, birth_date, guardian_phone)
            values (%s, date '2012-01-01', '01012345678')
            """,
            (student_id,),
        )

    teacher = AuthenticatedUser(
        user_id=teacher_id,
        email="teacher@example.com",
        provider="google",
        email_verified=True,
    )
    student = AuthenticatedUser(
        user_id=student_id,
        email="student@example.com",
        provider="password",
        email_verified=True,
    )
    description = "감사 로그에 복사되면 안 되는 상세 내용"
    location = "감사 로그에 복사되면 안 되는 장소"
    try:
        async with application_transaction(database_url=database_url) as connection:
            service = EventService(EventRepository(connection))
            created = await service.create(
                EventCreate(
                    title="주일예배",
                    description=description,
                    location=location,
                    starts_at=datetime(2026, 8, 23, 2, tzinfo=UTC),
                    ends_at=datetime(2026, 8, 23, 3, 30, tzinfo=UTC),
                    repeat_weekly=True,
                    repeat_until=date(2026, 9, 6),
                ),
                teacher,
            )
            occurrences = await service.occurrences(
                student, date(2026, 8, 31), date(2026, 9, 7)
            )
            updated = await service.update(
                created.id,
                EventUpdate(
                    title="주일 오전 예배",
                    description=description,
                    location=location,
                    starts_at=created.starts_at,
                    ends_at=created.ends_at,
                    repeat_weekly=True,
                    repeat_until=date(2026, 9, 6),
                ),
                teacher,
            )
            await service.delete(created.id, teacher)

        assert [item.local_start.date() for item in occurrences] == [date(2026, 9, 6)]
        assert updated.title == "주일 오전 예배"
        with psycopg.connect(database_url) as connection:
            audits = connection.execute(
                """
                select action, target_type, target_id, details
                from app.audit_logs
                where actor_id = %s and target_type = 'event'
                """,
                (teacher_id,),
            ).fetchall()
        audits_by_action = {row[0]: row[1:] for row in audits}
        assert set(audits_by_action) == {
            "event.created",
            "event.updated",
            "event.deleted",
        }
        assert {row[1] for row in audits} == {"event"}
        assert {row[2] for row in audits} == {str(created.id)}
        assert audits_by_action["event.updated"][2] == {
            "changed_fields": ["title"]
        }
        assert description not in repr(audits)
        assert location not in repr(audits)
    finally:
        with psycopg.connect(database_url) as connection:
            connection.execute(
                "delete from app.audit_logs where actor_id = %s", (teacher_id,)
            )
            connection.execute(
                "delete from app.student_profiles where user_id = %s", (student_id,)
            )
            connection.execute(
                "delete from app.staff_memberships where user_id = %s", (teacher_id,)
            )
            connection.execute(
                "delete from app.user_profiles where user_id in (%s, %s)",
                (teacher_id, student_id),
            )
            connection.execute(
                "delete from auth.users where id in (%s, %s)",
                (teacher_id, student_id),
            )
