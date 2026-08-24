import argparse
import json
import os
import sys
from pathlib import Path
from uuid import UUID

import psycopg

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT))

from fixtures.identity_environment import require_local_identity_environment


def main() -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    runtime_database_url = os.environ.get("DATABASE_URL")
    require_local_identity_environment(
        supabase_url=os.environ.get("SUPABASE_URL"),
        database_urls=(database_url, runtime_database_url),
    )
    if not database_url:
        raise RuntimeError("Local test database credentials are required.")
    parser = argparse.ArgumentParser()
    parser.add_argument("--teacher-id", required=True, type=UUID)
    parser.add_argument("--correction-scan-id", required=True, type=UUID)
    parser.add_argument("--admin-id", required=True, type=UUID)
    parser.add_argument("--kiosk-session-id", required=True, type=UUID)
    arguments = parser.parse_args()
    with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            with expected(action, actor_id, target_type, target_id) as (
              values
                ('attendance.corrected', %s::uuid, 'attendance_scan', %s::text),
                ('kiosk.session_deleted', %s::uuid, 'kiosk_session', %s::text)
            )
            select expected.action, count(audit.id)::integer
            from expected
            left join app.audit_logs as audit
              on audit.action = expected.action
             and audit.actor_id = expected.actor_id
             and audit.target_type = expected.target_type
             and audit.target_id = expected.target_id
            group by expected.action
            order by expected.action
            """,
            (
                arguments.teacher_id,
                str(arguments.correction_scan_id),
                arguments.admin_id,
                str(arguments.kiosk_session_id),
            ),
        )
        print(json.dumps(dict(cursor.fetchall()), sort_keys=True))


if __name__ == "__main__":
    main()
