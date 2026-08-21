import json
import os
import sys
from pathlib import Path

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
    with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select action, count(*)
            from app.audit_logs
            where action in ('attendance.corrected', 'kiosk.session_revoked')
            group by action
            order by action
            """
        )
        print(json.dumps(dict(cursor.fetchall()), sort_keys=True))


if __name__ == "__main__":
    main()
