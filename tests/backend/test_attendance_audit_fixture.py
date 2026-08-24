import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

AUDIT_FIXTURE = Path(__file__).parents[1] / "e2e" / "fixtures" / "attendance_audit.py"
LIBPQ_DESTINATION_ENVIRONMENT = ("PGHOST", "PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE")


def _loopback_database_url() -> str:
    database_url = os.environ.get("TEST_DATABASE_URL", "")
    if urlsplit(database_url).hostname not in {"127.0.0.1", "localhost", "::1"}:
        pytest.skip("A loopback TEST_DATABASE_URL is required")
    return database_url


def _fixture_environment(database_url: str) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(
        {
            "APP_ENV": "test",
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "TEST_DATABASE_URL": database_url,
            "DATABASE_URL": database_url,
        }
    )
    for name in (*LIBPQ_DESTINATION_ENVIRONMENT, "VERCEL", "VERCEL_ENV"):
        environment.pop(name, None)
    return environment


def _read_counts(
    database_url: str,
    *,
    teacher_id: UUID,
    correction_scan_id: UUID,
    admin_id: UUID,
    kiosk_session_id: UUID,
) -> dict[str, int]:
    result = subprocess.run(
        [
            sys.executable,
            str(AUDIT_FIXTURE),
            "--teacher-id",
            str(teacher_id),
            "--correction-scan-id",
            str(correction_scan_id),
            "--admin-id",
            str(admin_id),
            "--kiosk-session-id",
            str(kiosk_session_id),
        ],
        capture_output=True,
        check=False,
        env=_fixture_environment(database_url),
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_audit_fixture_ignores_historic_rows_and_counts_only_exact_run_targets() -> None:
    database_url = _loopback_database_url()
    teacher_id, admin_id, unrelated_actor_id = uuid4(), uuid4(), uuid4()
    correction_scan_id, kiosk_session_id = uuid4(), uuid4()
    wrong_scan_id, wrong_kiosk_id = uuid4(), uuid4()
    actors = [teacher_id, admin_id, unrelated_actor_id]
    targets = [correction_scan_id, kiosk_session_id, wrong_scan_id, wrong_kiosk_id]

    try:
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.executemany(
                "insert into auth.users (id) values (%s)",
                [(actor,) for actor in actors],
            )
            cursor.executemany(
                """
                insert into app.user_profiles (user_id, email, name)
                values (%s, %s, '감사 테스트')
                """,
                [(actor, f"audit-{actor.hex}@example.test") for actor in actors],
            )
            cursor.executemany(
                """
                insert into app.audit_logs (
                  actor_id, action, target_type, target_id, details
                ) values (%s, %s, %s, %s, %s)
                """,
                [
                    (teacher_id, "attendance.corrected", "attendance_scan", str(wrong_scan_id), Jsonb({"historic": True})),
                    (unrelated_actor_id, "attendance.corrected", "attendance_scan", str(correction_scan_id), Jsonb({"historic": True})),
                    (admin_id, "kiosk.session_deleted", "kiosk_session", str(wrong_kiosk_id), Jsonb({"historic": True})),
                    (unrelated_actor_id, "kiosk.session_deleted", "kiosk_session", str(kiosk_session_id), Jsonb({"historic": True})),
                ],
            )

        assert _read_counts(
            database_url,
            teacher_id=teacher_id,
            correction_scan_id=correction_scan_id,
            admin_id=admin_id,
            kiosk_session_id=kiosk_session_id,
        ) == {"attendance.corrected": 0, "kiosk.session_deleted": 0}

        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.executemany(
                """
                insert into app.audit_logs (
                  actor_id, action, target_type, target_id, details
                ) values (%s, %s, %s, %s, %s)
                """,
                [
                    (teacher_id, "attendance.corrected", "attendance_scan", str(correction_scan_id), Jsonb({"mode": "VOID"})),
                    (admin_id, "kiosk.session_deleted", "kiosk_session", str(kiosk_session_id), Jsonb({"reason": "administrator_deletion"})),
                ],
            )

        assert _read_counts(
            database_url,
            teacher_id=teacher_id,
            correction_scan_id=correction_scan_id,
            admin_id=admin_id,
            kiosk_session_id=kiosk_session_id,
        ) == {"attendance.corrected": 1, "kiosk.session_deleted": 1}
    finally:
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "delete from app.audit_logs where actor_id = any(%s) or target_id = any(%s)",
                (actors, [str(target) for target in targets]),
            )
            cursor.execute("delete from app.user_profiles where user_id = any(%s)", (actors,))
            cursor.execute("delete from auth.users where id = any(%s)", (actors,))
