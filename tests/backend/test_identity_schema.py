import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.errors import CheckViolation, InsufficientPrivilege, UniqueViolation


@pytest.fixture
def identity_connection() -> Iterator[psycopg.Connection[tuple[Any, ...]]]:
    connection = psycopg.connect(os.environ["TEST_DATABASE_URL"])
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


def seed_auth_users(
    connection: psycopg.Connection[tuple[Any, ...]], *user_ids: UUID
) -> None:
    for user_id in user_ids:
        connection.execute("insert into auth.users (id) values (%s)", (user_id,))


def insert_user_profile(
    connection: psycopg.Connection[tuple[Any, ...]],
    user_id: UUID,
    email: str,
) -> None:
    connection.execute(
        "insert into app.user_profiles (user_id, email, name) values (%s, %s, %s)",
        (user_id, email, "테스트 사용자"),
    )


def test_identity_tables_and_columns_exist(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    rows = identity_connection.execute(
        """
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'app'
        order by table_name, ordinal_position
        """
    ).fetchall()
    columns_by_table: dict[str, set[str]] = {}
    for table_name, column_name in rows:
        columns_by_table.setdefault(table_name, set()).add(column_name)

    assert columns_by_table == {
        "user_profiles": {
            "user_id",
            "email",
            "name",
            "phone",
            "created_at",
            "updated_at",
        },
        "student_profiles": {
            "user_id",
            "birth_date",
            "guardian_phone",
            "include_in_statistics",
        },
        "teacher_applications": {
            "id",
            "user_id",
            "status",
            "applied_at",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
        },
        "staff_memberships": {
            "user_id",
            "role",
            "approved_by",
            "created_at",
            "updated_at",
        },
        "audit_logs": {
            "id",
            "actor_id",
            "action",
            "target_type",
            "target_id",
            "details",
            "created_at",
        },
    }


def test_key_identity_columns_have_expected_types_and_defaults(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    rows = identity_connection.execute(
        """
        select table_name, column_name, udt_schema, udt_name,
               is_nullable, column_default
        from information_schema.columns
        where table_schema = 'app'
          and (table_name, column_name) in (
            ('user_profiles', 'user_id'),
            ('student_profiles', 'birth_date'),
            ('student_profiles', 'include_in_statistics'),
            ('teacher_applications', 'status'),
            ('staff_memberships', 'role'),
            ('audit_logs', 'details')
          )
        """
    ).fetchall()

    assert set(rows) == {
        ("user_profiles", "user_id", "pg_catalog", "uuid", "NO", None),
        ("student_profiles", "birth_date", "pg_catalog", "date", "NO", None),
        (
            "student_profiles",
            "include_in_statistics",
            "pg_catalog",
            "bool",
            "NO",
            "true",
        ),
        (
            "teacher_applications",
            "status",
            "app",
            "teacher_application_status",
            "NO",
            "'pending'::app.teacher_application_status",
        ),
        ("staff_memberships", "role", "app", "staff_role", "NO", None),
        (
            "audit_logs",
            "details",
            "pg_catalog",
            "jsonb",
            "NO",
            "'{}'::jsonb",
        ),
    }


def test_identity_enums_have_only_supported_values(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    rows = identity_connection.execute(
        """
        select type_name, array_agg(enum_label order by sort_order)
        from (
          select t.typname as type_name,
                 e.enumlabel as enum_label,
                 e.enumsortorder as sort_order
          from pg_type t
          join pg_namespace n on n.oid = t.typnamespace
          join pg_enum e on e.enumtypid = t.oid
          where n.nspname = 'app'
        ) enums
        group by type_name
        """
    ).fetchall()

    assert dict(rows) == {
        "teacher_application_status": ["pending", "approved", "rejected"],
        "staff_role": ["teacher", "admin"],
    }


def test_backend_role_is_unprivileged_and_assumable_by_database_owner(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    attributes = identity_connection.execute(
        """
        select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
               rolinherit, rolreplication, rolbypassrls
        from pg_roles
        where rolname = 'app_backend'
        """
    ).fetchone()
    membership = identity_connection.execute(
        "select pg_has_role(current_user, 'app_backend', 'MEMBER')"
    ).fetchone()
    unexpected_members = identity_connection.execute(
        """
        select member.rolname
        from pg_auth_members membership
        join pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_roles member on member.oid = membership.member
        where granted_role.rolname = 'app_backend'
          and member.rolname <> 'postgres'
        """
    ).fetchall()
    outbound_memberships = identity_connection.execute(
        """
        select granted_role.rolname
        from pg_auth_members membership
        join pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_roles member on member.oid = membership.member
        where member.rolname = 'app_backend'
        """
    ).fetchall()

    assert attributes == (False, False, False, False, False, False, False)
    assert membership == (True,)
    assert unexpected_members == []
    assert outbound_memberships == []

    identity_connection.execute("set local role app_backend")
    assert identity_connection.execute("select current_user").fetchone() == (
        "app_backend",
    )


def test_identity_table_grants_are_least_privilege(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    grants = set(
        identity_connection.execute(
            """
            select grantee, table_name, privilege_type
            from information_schema.role_table_grants
            where table_schema = 'app'
              and grantee in ('app_backend', 'anon', 'authenticated')
            """
        ).fetchall()
    )

    assert grants == {
        ("app_backend", "user_profiles", "SELECT"),
        ("app_backend", "user_profiles", "INSERT"),
        ("app_backend", "user_profiles", "UPDATE"),
        ("app_backend", "user_profiles", "DELETE"),
        ("app_backend", "student_profiles", "SELECT"),
        ("app_backend", "student_profiles", "INSERT"),
        ("app_backend", "student_profiles", "UPDATE"),
        ("app_backend", "student_profiles", "DELETE"),
        ("app_backend", "teacher_applications", "SELECT"),
        ("app_backend", "teacher_applications", "INSERT"),
        ("app_backend", "teacher_applications", "UPDATE"),
        ("app_backend", "teacher_applications", "DELETE"),
        ("app_backend", "staff_memberships", "SELECT"),
        ("app_backend", "staff_memberships", "INSERT"),
        ("app_backend", "staff_memberships", "UPDATE"),
        ("app_backend", "staff_memberships", "DELETE"),
        ("app_backend", "audit_logs", "SELECT"),
        ("app_backend", "audit_logs", "INSERT"),
    }

    schema_access = identity_connection.execute(
        """
        select has_schema_privilege('app_backend', 'app', 'USAGE'),
               has_schema_privilege('anon', 'app', 'USAGE'),
               has_schema_privilege('authenticated', 'app', 'USAGE')
        """
    ).fetchone()
    assert schema_access == (True, False, False)


def test_identity_tables_have_expected_rls_policies(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    rls_tables = set(
        identity_connection.execute(
            """
            select c.relname
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'app'
              and c.relkind = 'r'
              and c.relrowsecurity
            """
        ).fetchall()
    )
    policies = set(
        identity_connection.execute(
            """
            select tablename, cmd, roles::text, qual, with_check
            from pg_policies
            where schemaname = 'app'
            """
        ).fetchall()
    )

    assert rls_tables == {
        ("user_profiles",),
        ("student_profiles",),
        ("teacher_applications",),
        ("staff_memberships",),
        ("audit_logs",),
    }
    assert policies == {
        ("user_profiles", "ALL", "{app_backend}", "true", "true"),
        ("student_profiles", "ALL", "{app_backend}", "true", "true"),
        ("teacher_applications", "ALL", "{app_backend}", "true", "true"),
        ("staff_memberships", "ALL", "{app_backend}", "true", "true"),
        ("audit_logs", "SELECT", "{app_backend}", "true", None),
        ("audit_logs", "INSERT", "{app_backend}", None, "true"),
    }


@pytest.mark.parametrize("browser_role", ["anon", "authenticated"])
def test_browser_roles_cannot_read_private_identity_tables(
    identity_connection: psycopg.Connection[tuple[Any, ...]], browser_role: str
) -> None:
    identity_connection.execute(
        sql.SQL("set local role {}").format(sql.Identifier(browser_role))
    )

    with pytest.raises(InsufficientPrivilege):
        identity_connection.execute("select * from app.user_profiles")


def test_backend_role_can_operate_on_mutable_identity_tables(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    reviewer_id = uuid4()
    applicant_id = uuid4()
    seed_auth_users(identity_connection, reviewer_id, applicant_id)
    identity_connection.execute("set local role app_backend")
    insert_user_profile(identity_connection, reviewer_id, "reviewer@example.com")
    insert_user_profile(identity_connection, applicant_id, "applicant@example.com")

    identity_connection.execute(
        """
        insert into app.student_profiles (user_id, birth_date, guardian_phone)
        values (%s, date '2010-01-01', '01012345678')
        """,
        (applicant_id,),
    )
    application_id = identity_connection.execute(
        "insert into app.teacher_applications (user_id) values (%s) returning id",
        (applicant_id,),
    ).fetchone()[0]
    identity_connection.execute(
        "insert into app.staff_memberships (user_id, role) values (%s, 'teacher')",
        (reviewer_id,),
    )
    identity_connection.execute(
        """
        insert into app.audit_logs (actor_id, action, target_type, target_id, details)
        values (%s, 'application.created', 'teacher_application', %s, '{}'::jsonb)
        """,
        (reviewer_id, str(application_id)),
    )

    identity_connection.execute(
        "update app.user_profiles set name = '변경된 사용자' where user_id = %s",
        (applicant_id,),
    )
    identity_connection.execute(
        """
        update app.student_profiles
        set include_in_statistics = false
        where user_id = %s
        """,
        (applicant_id,),
    )
    identity_connection.execute(
        """
        update app.teacher_applications
        set status = 'rejected', reviewed_by = %s, reviewed_at = now(),
            rejection_reason = '승인 기준 미충족'
        where id = %s
        """,
        (reviewer_id, application_id),
    )
    identity_connection.execute(
        "update app.staff_memberships set role = 'admin' where user_id = %s",
        (reviewer_id,),
    )

    assert identity_connection.execute(
        """
        select u.name, s.include_in_statistics, t.status::text, m.role::text
        from app.user_profiles u
        join app.student_profiles s on s.user_id = u.user_id
        join app.teacher_applications t on t.user_id = u.user_id
        join app.staff_memberships m on m.user_id = %s
        where u.user_id = %s
        """,
        (reviewer_id, applicant_id),
    ).fetchone() == ("변경된 사용자", False, "rejected", "admin")

    identity_connection.execute(
        "delete from app.teacher_applications where id = %s", (application_id,)
    )
    identity_connection.execute(
        "delete from app.student_profiles where user_id = %s", (applicant_id,)
    )
    identity_connection.execute(
        "delete from app.user_profiles where user_id = %s", (applicant_id,)
    )
    identity_connection.execute(
        "delete from app.staff_memberships where user_id = %s", (reviewer_id,)
    )
    assert identity_connection.execute(
        "select count(*) from app.audit_logs"
    ).fetchone() == (1,)


@pytest.mark.parametrize(
    "statement",
    [
        "update app.audit_logs set action = 'tampered'",
        "delete from app.audit_logs",
    ],
    ids=["update", "delete"],
)
def test_backend_role_cannot_mutate_audit_history(
    identity_connection: psycopg.Connection[tuple[Any, ...]], statement: str
) -> None:
    actor_id = uuid4()
    seed_auth_users(identity_connection, actor_id)
    insert_user_profile(identity_connection, actor_id, "actor@example.com")
    identity_connection.execute(
        """
        insert into app.audit_logs (actor_id, action, target_type, target_id, details)
        values (%s, 'created', 'test', '1', '{}'::jsonb)
        """,
        (actor_id,),
    )
    identity_connection.execute("set local role app_backend")

    with pytest.raises(InsufficientPrivilege), identity_connection.transaction():
        identity_connection.execute(statement)

    assert identity_connection.execute(
        "select action from app.audit_logs"
    ).fetchone() == ("created",)


@pytest.mark.parametrize("rejection_reason", [None, "", "   "])
def test_rejected_application_requires_nonblank_reason(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
    rejection_reason: str | None,
) -> None:
    reviewer_id = uuid4()
    applicant_id = uuid4()
    seed_auth_users(identity_connection, reviewer_id, applicant_id)
    insert_user_profile(identity_connection, reviewer_id, "reviewer@example.com")
    insert_user_profile(identity_connection, applicant_id, "applicant@example.com")

    with pytest.raises(CheckViolation):
        identity_connection.execute(
            """
            insert into app.teacher_applications (
              user_id, status, reviewed_by, reviewed_at, rejection_reason
            ) values (%s, 'rejected', %s, now(), %s)
            """,
            (applicant_id, reviewer_id, rejection_reason),
        )


@pytest.mark.parametrize(
    ("status", "include_review", "rejection_reason"),
    [
        ("pending", True, None),
        ("approved", False, None),
        ("approved", True, "approved applications cannot have a rejection reason"),
    ],
)
def test_teacher_application_review_states_are_consistent(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
    status: str,
    include_review: bool,
    rejection_reason: str | None,
) -> None:
    reviewer_id = uuid4()
    applicant_id = uuid4()
    seed_auth_users(identity_connection, reviewer_id, applicant_id)
    insert_user_profile(identity_connection, reviewer_id, "reviewer@example.com")
    insert_user_profile(identity_connection, applicant_id, "applicant@example.com")
    reviewed_by = reviewer_id if include_review else None

    with pytest.raises(CheckViolation):
        identity_connection.execute(
            """
            insert into app.teacher_applications (
              user_id, status, reviewed_by, reviewed_at, rejection_reason
            ) values (%s, %s, %s, case when %s then now() end, %s)
            """,
            (
                applicant_id,
                status,
                reviewed_by,
                include_review,
                rejection_reason,
            ),
        )


def test_future_birth_date_is_rejected(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    student_id = uuid4()
    seed_auth_users(identity_connection, student_id)
    insert_user_profile(identity_connection, student_id, "student@example.com")

    with pytest.raises(CheckViolation):
        identity_connection.execute(
            """
            insert into app.student_profiles (user_id, birth_date, guardian_phone)
            values (%s, %s, '01012345678')
            """,
            (student_id, datetime.now(UTC).date() + timedelta(days=1)),
        )


def test_profile_updated_at_cannot_precede_created_at(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    user_id = uuid4()
    seed_auth_users(identity_connection, user_id)

    with pytest.raises(CheckViolation):
        identity_connection.execute(
            """
            insert into app.user_profiles (
              user_id, email, name, created_at, updated_at
            ) values (%s, 'timestamps@example.com', '시간 테스트', now(),
                      now() - interval '1 day')
            """,
            (user_id,),
        )


def test_application_review_cannot_predate_application(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    reviewer_id = uuid4()
    applicant_id = uuid4()
    seed_auth_users(identity_connection, reviewer_id, applicant_id)
    insert_user_profile(identity_connection, reviewer_id, "reviewer@example.com")
    insert_user_profile(identity_connection, applicant_id, "applicant@example.com")

    with pytest.raises(CheckViolation):
        identity_connection.execute(
            """
            insert into app.teacher_applications (
              user_id, status, reviewed_by, applied_at, reviewed_at
            ) values (%s, 'approved', %s, now(), now() - interval '1 day')
            """,
            (applicant_id, reviewer_id),
        )


def test_only_one_pending_application_per_user(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    applicant_id = uuid4()
    seed_auth_users(identity_connection, applicant_id)
    insert_user_profile(identity_connection, applicant_id, "applicant@example.com")
    identity_connection.execute(
        "insert into app.teacher_applications (user_id) values (%s)",
        (applicant_id,),
    )

    with pytest.raises(UniqueViolation):
        identity_connection.execute(
            "insert into app.teacher_applications (user_id) values (%s)",
            (applicant_id,),
        )


def test_case_insensitive_email_uniqueness_is_enforced(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    first_user_id = uuid4()
    second_user_id = uuid4()
    seed_auth_users(identity_connection, first_user_id, second_user_id)
    insert_user_profile(identity_connection, first_user_id, "Student@Example.com")

    with pytest.raises(UniqueViolation):
        insert_user_profile(identity_connection, second_user_id, "student@example.com")


def test_audit_details_must_be_a_json_object(
    identity_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    with pytest.raises(CheckViolation):
        identity_connection.execute(
            """
            insert into app.audit_logs (action, target_type, target_id, details)
            values ('invalid', 'test', '1', '[]'::jsonb)
            """
        )
