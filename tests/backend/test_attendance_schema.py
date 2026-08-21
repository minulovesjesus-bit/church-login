import os
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.errors import CheckViolation, InsufficientPrivilege, UniqueViolation


@pytest.fixture
def attendance_connection() -> Iterator[psycopg.Connection[tuple[Any, ...]]]:
    connection = psycopg.connect(os.environ["TEST_DATABASE_URL"])
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


def test_attendance_constraints(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    tables = {
        row[0]
        for row in attendance_connection.execute(
            "select table_name from information_schema.tables "
            "where table_schema = 'app'"
        )
    }
    assert {"kiosk_sessions", "attendance_scans", "rate_limit_buckets"} <= tables

    constraints = attendance_connection.execute(
        """
        select con.conname, pg_get_constraintdef(con.oid)
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'app'
          and rel.relname = 'attendance_scans'
        """
    ).fetchall()
    constraints_by_name = dict(constraints)
    assert constraints_by_name["attendance_scans_student_request_unique"] == (
        "UNIQUE (student_id, request_id)"
    )
    assert constraints_by_name["attendance_scans_source_fields_consistent"] == (
        "CHECK ((((source <> 'QR'::app.attendance_source) OR "
        "((kiosk_session_id IS NOT NULL) AND (qr_issued_at IS NOT NULL))) AND "
        "((source <> 'MANUAL'::app.attendance_source) OR "
        "(recorded_by IS NOT NULL))))"
    )
    assert constraints_by_name["attendance_scans_void_metadata_complete"] == (
        "CHECK ((((voided_at IS NULL) AND (voided_by IS NULL) AND "
        "(void_reason IS NULL)) OR ((voided_at IS NOT NULL) AND "
        "(voided_by IS NOT NULL) AND (void_reason IS NOT NULL) AND "
        "(length(btrim(void_reason)) >= 1))))"
    )


def _seed_auth_user(
    connection: psycopg.Connection[tuple[Any, ...]], user_id: UUID
) -> None:
    connection.execute("insert into auth.users (id) values (%s)", (user_id,))


def _seed_user_profile(
    connection: psycopg.Connection[tuple[Any, ...]],
    user_id: UUID,
    email: str,
) -> None:
    _seed_auth_user(connection, user_id)
    connection.execute(
        "insert into app.user_profiles (user_id, email, name) values (%s, %s, %s)",
        (user_id, email, "출석 스키마 테스트"),
    )


def _seed_student(
    connection: psycopg.Connection[tuple[Any, ...]], user_id: UUID
) -> None:
    _seed_user_profile(connection, user_id, f"{user_id}@student.example.com")
    connection.execute(
        """
        insert into app.student_profiles (user_id, birth_date, guardian_phone)
        values (%s, date '2010-01-01', '01012345678')
        """,
        (user_id,),
    )


def _seed_staff(
    connection: psycopg.Connection[tuple[Any, ...]], user_id: UUID
) -> None:
    _seed_user_profile(connection, user_id, f"{user_id}@staff.example.com")
    connection.execute(
        "insert into app.staff_memberships (user_id, role) values (%s, 'teacher')",
        (user_id,),
    )


def _insert_kiosk_session(
    connection: psycopg.Connection[tuple[Any, ...]],
) -> UUID:
    return connection.execute(
        """
        insert into app.kiosk_sessions (refresh_token_hash, refresh_expires_at)
        values ('keyed-refresh-token-hash', now() + interval '30 days')
        returning id
        """
    ).fetchone()[0]


def _insert_qr_scan(
    connection: psycopg.Connection[tuple[Any, ...]],
    student_id: UUID,
    kiosk_session_id: UUID,
    *,
    request_id: UUID | None = None,
) -> UUID:
    return connection.execute(
        """
        insert into app.attendance_scans (
          student_id, attendance_date, direction, scanned_at,
          kiosk_session_id, request_id, qr_issued_at
        ) values (%s, date '2026-08-21', 'IN', %s, %s, %s, %s)
        returning id
        """,
        (
            student_id,
            datetime(2026, 8, 21, 1, tzinfo=UTC),
            kiosk_session_id,
            request_id or uuid4(),
            datetime(2026, 8, 21, 0, 59, 50, tzinfo=UTC),
        ),
    ).fetchone()[0]


def test_attendance_columns_have_exact_shapes(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    rows = attendance_connection.execute(
        """
        select table_name, column_name, udt_schema, udt_name,
               is_nullable, column_default
        from information_schema.columns
        where table_schema = 'app'
          and table_name in (
            'kiosk_sessions', 'attendance_scans', 'rate_limit_buckets'
          )
        order by table_name, ordinal_position
        """
    ).fetchall()

    assert rows == [
        ("attendance_scans", "id", "pg_catalog", "uuid", "NO", "gen_random_uuid()"),
        ("attendance_scans", "student_id", "pg_catalog", "uuid", "NO", None),
        ("attendance_scans", "attendance_date", "pg_catalog", "date", "NO", None),
        ("attendance_scans", "direction", "app", "attendance_direction", "NO", None),
        ("attendance_scans", "scanned_at", "pg_catalog", "timestamptz", "NO", None),
        ("attendance_scans", "kiosk_session_id", "pg_catalog", "uuid", "YES", None),
        ("attendance_scans", "request_id", "pg_catalog", "uuid", "NO", None),
        ("attendance_scans", "qr_issued_at", "pg_catalog", "timestamptz", "YES", None),
        (
            "attendance_scans",
            "source",
            "app",
            "attendance_source",
            "NO",
            "'QR'::app.attendance_source",
        ),
        ("attendance_scans", "recorded_by", "pg_catalog", "uuid", "YES", None),
        ("attendance_scans", "voided_at", "pg_catalog", "timestamptz", "YES", None),
        ("attendance_scans", "voided_by", "pg_catalog", "uuid", "YES", None),
        ("attendance_scans", "void_reason", "pg_catalog", "text", "YES", None),
        ("kiosk_sessions", "id", "pg_catalog", "uuid", "NO", "gen_random_uuid()"),
        ("kiosk_sessions", "refresh_token_hash", "pg_catalog", "text", "NO", None),
        ("kiosk_sessions", "created_at", "pg_catalog", "timestamptz", "NO", "now()"),
        ("kiosk_sessions", "last_seen_at", "pg_catalog", "timestamptz", "NO", "now()"),
        ("kiosk_sessions", "refresh_expires_at", "pg_catalog", "timestamptz", "NO", None),
        ("kiosk_sessions", "revoked_at", "pg_catalog", "timestamptz", "YES", None),
        ("kiosk_sessions", "revoked_by", "pg_catalog", "uuid", "YES", None),
        ("rate_limit_buckets", "bucket_key_hash", "pg_catalog", "text", "NO", None),
        ("rate_limit_buckets", "action", "pg_catalog", "text", "NO", None),
        (
            "rate_limit_buckets",
            "window_started_at",
            "pg_catalog",
            "timestamptz",
            "NO",
            None,
        ),
        ("rate_limit_buckets", "attempt_count", "pg_catalog", "int4", "NO", None),
        ("rate_limit_buckets", "blocked_until", "pg_catalog", "timestamptz", "YES", None),
        ("rate_limit_buckets", "updated_at", "pg_catalog", "timestamptz", "NO", None),
    ]


def test_attendance_enums_have_exact_values(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    rows = attendance_connection.execute(
        """
        select t.typname, array_agg(e.enumlabel order by e.enumsortorder)
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        join pg_enum e on e.enumtypid = t.oid
        where n.nspname = 'app'
          and t.typname in ('attendance_direction', 'attendance_source')
        group by t.typname
        """
    ).fetchall()

    assert dict(rows) == {
        "attendance_direction": ["IN", "OUT"],
        "attendance_source": ["QR", "MANUAL"],
    }


def test_attendance_indexes_have_exact_shapes(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    rows = attendance_connection.execute(
        """
        select idx.relname, pg_get_indexdef(idx.oid),
               pg_get_expr(ind.indpred, ind.indrelid)
        from pg_index ind
        join pg_class idx on idx.oid = ind.indexrelid
        join pg_class tbl on tbl.oid = ind.indrelid
        join pg_namespace nsp on nsp.oid = tbl.relnamespace
        where nsp.nspname = 'app'
          and idx.relname in (
            'attendance_scans_student_date_scanned_at_idx',
            'kiosk_sessions_active_refresh_expires_at_idx',
            'kiosk_sessions_refresh_token_hash_key',
            'attendance_scans_non_voided_student_date_scanned_at_idx',
            'attendance_scans_recent_idx'
          )
        """
    ).fetchall()

    assert set(rows) == {
        (
            "attendance_scans_student_date_scanned_at_idx",
            (
                "CREATE INDEX attendance_scans_student_date_scanned_at_idx ON "
                "app.attendance_scans USING btree "
                "(student_id, attendance_date, scanned_at)"
            ),
            None,
        ),
        (
            "kiosk_sessions_active_refresh_expires_at_idx",
            (
                "CREATE INDEX kiosk_sessions_active_refresh_expires_at_idx ON "
                "app.kiosk_sessions USING btree (refresh_expires_at) "
                "WHERE (revoked_at IS NULL)"
            ),
            "(revoked_at IS NULL)",
        ),
        (
            "kiosk_sessions_refresh_token_hash_key",
            (
                "CREATE UNIQUE INDEX kiosk_sessions_refresh_token_hash_key ON "
                "app.kiosk_sessions USING btree (refresh_token_hash)"
            ),
            None,
        ),
        (
            "attendance_scans_non_voided_student_date_scanned_at_idx",
            (
                "CREATE INDEX attendance_scans_non_voided_student_date_scanned_at_idx "
                "ON app.attendance_scans USING btree "
                "(student_id, attendance_date, scanned_at) "
                "WHERE (voided_at IS NULL)"
            ),
            "(voided_at IS NULL)",
        ),
        (
            "attendance_scans_recent_idx",
            (
                "CREATE INDEX attendance_scans_recent_idx ON "
                "app.attendance_scans USING btree (scanned_at DESC, id DESC)"
            ),
            None,
        ),
    }


def test_backend_role_attributes_remain_unprivileged(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    attributes = attendance_connection.execute(
        """
        select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
               rolinherit, rolreplication, rolbypassrls
        from pg_roles
        where rolname = 'app_backend'
        """
    ).fetchone()

    assert attributes == (False, False, False, False, False, False, False)


def test_attendance_grants_are_least_privilege(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    table_grants = set(
        attendance_connection.execute(
            """
            select grantee, table_name, privilege_type
            from information_schema.role_table_grants
            where table_schema = 'app'
              and table_name in (
                'kiosk_sessions', 'attendance_scans', 'rate_limit_buckets'
              )
              and grantee in ('app_backend', 'anon', 'authenticated')
            """
        ).fetchall()
    )
    attendance_update_columns = set(
        attendance_connection.execute(
            """
            select column_name
            from information_schema.role_column_grants
            where table_schema = 'app'
              and table_name = 'attendance_scans'
              and grantee = 'app_backend'
              and privilege_type = 'UPDATE'
            """
        ).fetchall()
    )

    assert table_grants == {
        ("app_backend", "kiosk_sessions", "SELECT"),
        ("app_backend", "kiosk_sessions", "INSERT"),
        ("app_backend", "kiosk_sessions", "UPDATE"),
        ("app_backend", "kiosk_sessions", "DELETE"),
        ("app_backend", "attendance_scans", "SELECT"),
        ("app_backend", "attendance_scans", "INSERT"),
        ("app_backend", "rate_limit_buckets", "SELECT"),
        ("app_backend", "rate_limit_buckets", "INSERT"),
        ("app_backend", "rate_limit_buckets", "UPDATE"),
        ("app_backend", "rate_limit_buckets", "DELETE"),
    }
    assert attendance_update_columns == {("voided_at",), ("voided_by",), ("void_reason",)}


def test_attendance_tables_have_backend_only_rls_policies(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    rls_tables = set(
        attendance_connection.execute(
            """
            select c.relname
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'app'
              and c.relname in (
                'kiosk_sessions', 'attendance_scans', 'rate_limit_buckets'
              )
              and c.relrowsecurity
            """
        ).fetchall()
    )
    policies = set(
        attendance_connection.execute(
            """
            select tablename, cmd, roles::text, qual, with_check
            from pg_policies
            where schemaname = 'app'
              and tablename in (
                'kiosk_sessions', 'attendance_scans', 'rate_limit_buckets'
              )
            """
        ).fetchall()
    )

    assert rls_tables == {
        ("kiosk_sessions",),
        ("attendance_scans",),
        ("rate_limit_buckets",),
    }
    assert policies == {
        ("kiosk_sessions", "ALL", "{app_backend}", "true", "true"),
        ("attendance_scans", "SELECT", "{app_backend}", "true", None),
        ("attendance_scans", "INSERT", "{app_backend}", None, "true"),
        ("attendance_scans", "UPDATE", "{app_backend}", "true", "true"),
        ("rate_limit_buckets", "ALL", "{app_backend}", "true", "true"),
    }


@pytest.mark.parametrize("browser_role", ["anon", "authenticated"])
@pytest.mark.parametrize(
    "table_name", ["kiosk_sessions", "attendance_scans", "rate_limit_buckets"]
)
def test_browser_roles_cannot_read_private_attendance_tables(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
    browser_role: str,
    table_name: str,
) -> None:
    attendance_connection.execute(
        sql.SQL("set local role {}").format(sql.Identifier(browser_role))
    )

    with pytest.raises(InsufficientPrivilege):
        attendance_connection.execute(
            sql.SQL("select * from app.{}").format(sql.Identifier(table_name))
        )


@pytest.mark.parametrize(
    ("source", "include_kiosk", "include_qr_time", "include_recorder"),
    [
        ("QR", False, True, False),
        ("QR", True, False, False),
        ("MANUAL", False, False, False),
    ],
)
def test_source_specific_required_fields_are_enforced(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
    source: str,
    include_kiosk: bool,
    include_qr_time: bool,
    include_recorder: bool,
) -> None:
    student_id = uuid4()
    recorder_id = uuid4()
    _seed_student(attendance_connection, student_id)
    _seed_user_profile(attendance_connection, recorder_id, "recorder@example.com")
    kiosk_session_id = _insert_kiosk_session(attendance_connection)

    with pytest.raises(CheckViolation):
        attendance_connection.execute(
            """
            insert into app.attendance_scans (
              student_id, attendance_date, direction, scanned_at,
              kiosk_session_id, request_id, qr_issued_at, source, recorded_by
            ) values (%s, date '2026-08-21', 'IN', %s, %s, %s, %s, %s, %s)
            """,
            (
                student_id,
                datetime(2026, 8, 21, 1, tzinfo=UTC),
                kiosk_session_id if include_kiosk else None,
                uuid4(),
                datetime(2026, 8, 21, 0, 59, 50, tzinfo=UTC)
                if include_qr_time
                else None,
                source,
                recorder_id if include_recorder else None,
            ),
        )


def test_qr_and_manual_rows_accept_their_compatible_nullable_fields(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    student_id = uuid4()
    recorder_id = uuid4()
    _seed_student(attendance_connection, student_id)
    _seed_user_profile(attendance_connection, recorder_id, "recorder@example.com")
    kiosk_session_id = _insert_kiosk_session(attendance_connection)

    qr_scan_id = _insert_qr_scan(
        attendance_connection, student_id, kiosk_session_id
    )
    manual_scan_id = attendance_connection.execute(
        """
        insert into app.attendance_scans (
          student_id, attendance_date, direction, scanned_at,
          request_id, source, recorded_by
        ) values (%s, date '2026-08-21', 'OUT', %s, %s, 'MANUAL', %s)
        returning id
        """,
        (
            student_id,
            datetime(2026, 8, 21, 2, tzinfo=UTC),
            uuid4(),
            recorder_id,
        ),
    ).fetchone()[0]

    assert attendance_connection.execute(
        """
        select id, source::text, kiosk_session_id is null, qr_issued_at is null,
               recorded_by is null
        from app.attendance_scans
        where id in (%s, %s)
        order by source
        """,
        (qr_scan_id, manual_scan_id),
    ).fetchall() == [
        (manual_scan_id, "MANUAL", True, True, False),
        (qr_scan_id, "QR", False, False, True),
    ]


def test_student_request_id_is_unique(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    student_id = uuid4()
    kiosk_session_id = uuid4()
    request_id = uuid4()
    _seed_student(attendance_connection, student_id)
    attendance_connection.execute(
        """
        insert into app.kiosk_sessions (id, refresh_token_hash, refresh_expires_at)
        values (%s, 'refresh-hash', now() + interval '30 days')
        """,
        (kiosk_session_id,),
    )
    _insert_qr_scan(
        attendance_connection,
        student_id,
        kiosk_session_id,
        request_id=request_id,
    )

    with pytest.raises(UniqueViolation):
        _insert_qr_scan(
            attendance_connection,
            student_id,
            kiosk_session_id,
            request_id=request_id,
        )


def test_backend_can_append_and_void_but_cannot_rewrite_or_delete_scans(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    student_id = uuid4()
    staff_id = uuid4()
    _seed_student(attendance_connection, student_id)
    _seed_staff(attendance_connection, staff_id)
    kiosk_session_id = _insert_kiosk_session(attendance_connection)
    attendance_connection.execute("set local role app_backend")
    scan_id = _insert_qr_scan(attendance_connection, student_id, kiosk_session_id)

    with pytest.raises(CheckViolation), attendance_connection.transaction():
        attendance_connection.execute(
            "update app.attendance_scans set voided_at = now() where id = %s",
            (scan_id,),
        )

    attendance_connection.execute(
        """
        update app.attendance_scans
        set voided_at = now(), voided_by = %s, void_reason = '중복 기록'
        where id = %s
        """,
        (staff_id, scan_id),
    )
    assert attendance_connection.execute(
        """
        select voided_at is not null, voided_by, void_reason
        from app.attendance_scans where id = %s
        """,
        (scan_id,),
    ).fetchone() == (True, staff_id, "중복 기록")

    with pytest.raises(InsufficientPrivilege), attendance_connection.transaction():
        attendance_connection.execute(
            "update app.attendance_scans set direction = 'OUT' where id = %s",
            (scan_id,),
        )
    with pytest.raises(InsufficientPrivilege), attendance_connection.transaction():
        attendance_connection.execute(
            "delete from app.attendance_scans where id = %s", (scan_id,)
        )


def test_backend_can_crud_kiosks_and_hashed_rate_limit_buckets(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    staff_id = uuid4()
    _seed_staff(attendance_connection, staff_id)
    attendance_connection.execute("set local role app_backend")
    kiosk_session_id = _insert_kiosk_session(attendance_connection)
    attendance_connection.execute(
        """
        update app.kiosk_sessions
        set last_seen_at = now(), revoked_at = now(), revoked_by = %s
        where id = %s
        """,
        (staff_id, kiosk_session_id),
    )
    attendance_connection.execute(
        """
        insert into app.rate_limit_buckets (
          bucket_key_hash, action, window_started_at,
          attempt_count, blocked_until, updated_at
        ) values ('hmac-sha256:opaque-key', 'kiosk.login', now(), 1, null, now())
        """
    )
    attendance_connection.execute(
        """
        update app.rate_limit_buckets
        set attempt_count = 2, blocked_until = now() + interval '1 minute',
            updated_at = now()
        where bucket_key_hash = 'hmac-sha256:opaque-key'
          and action = 'kiosk.login'
        """
    )

    assert attendance_connection.execute(
        """
        select refresh_token_hash, revoked_by
        from app.kiosk_sessions where id = %s
        """,
        (kiosk_session_id,),
    ).fetchone() == ("keyed-refresh-token-hash", staff_id)
    assert attendance_connection.execute(
        """
        select bucket_key_hash, action, attempt_count, blocked_until is not null
        from app.rate_limit_buckets
        """
    ).fetchone() == ("hmac-sha256:opaque-key", "kiosk.login", 2, True)

    attendance_connection.execute(
        "delete from app.rate_limit_buckets where action = 'kiosk.login'"
    )
    attendance_connection.execute(
        "delete from app.kiosk_sessions where id = %s", (kiosk_session_id,)
    )
    assert attendance_connection.execute(
        "select count(*) from app.rate_limit_buckets"
    ).fetchone() == (0,)


def test_rate_limit_primary_key_and_private_key_shape(
    attendance_connection: psycopg.Connection[tuple[Any, ...]],
) -> None:
    primary_key = attendance_connection.execute(
        """
        select pg_get_constraintdef(con.oid)
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'app'
          and rel.relname = 'rate_limit_buckets'
          and con.contype = 'p'
        """
    ).fetchone()
    identifying_columns = set(
        attendance_connection.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = 'app'
              and table_name = 'rate_limit_buckets'
              and (
                column_name ilike '%ip%'
                or column_name ilike '%user%'
                or column_name ilike '%session%'
              )
            """
        ).fetchall()
    )

    assert primary_key == ("PRIMARY KEY (bucket_key_hash, action)",)
    assert identifying_columns == set()
