import os
import sys
from pathlib import Path
from uuid import UUID

import httpx
import psycopg

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT))

from fixtures.identity_environment import (
    require_local_identity_environment,
)

FIXTURES = (
    ("00000000-0000-4000-8000-000000000101", "incomplete.student@example.test"),
    ("00000000-0000-4000-8000-000000000201", "pending.teacher@example.test"),
    ("00000000-0000-4000-8000-000000000202", "approved.teacher@example.test"),
    ("00000000-0000-4000-8000-000000000301", "admin.identity@example.test"),
)
PASSWORD = "Identity-e2e-2026!"


def require_local_test_environment() -> tuple[str, str, str]:
    supabase_url = os.environ.get("SUPABASE_URL", "")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    database_url = os.environ.get("TEST_DATABASE_URL")
    runtime_database_url = os.environ.get("DATABASE_URL")
    require_local_identity_environment(
        supabase_url=supabase_url,
        database_urls=(database_url, runtime_database_url),
    )
    if not service_key or not database_url:
        raise RuntimeError("Local Supabase fixture credentials are required.")
    return supabase_url.rstrip("/"), service_key, database_url


def auth_headers(service_key: str) -> dict[str, str]:
    return {"apikey": service_key, "Authorization": f"Bearer {service_key}"}


def remove_users(client: httpx.Client, supabase_url: str) -> None:
    for user_id, _ in FIXTURES:
        response = client.delete(f"{supabase_url}/auth/v1/admin/users/{user_id}")
        if response.status_code not in {200, 204, 404}:
            response.raise_for_status()


def remove_identity_rows(database_url: str) -> None:
    user_ids = [UUID(user_id) for user_id, _ in FIXTURES]
    with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "delete from app.audit_logs where actor_id = any(%s::uuid[])",
            (user_ids,),
        )
        cursor.execute(
            "delete from app.teacher_applications where user_id = any(%s::uuid[])",
            (user_ids,),
        )
        cursor.execute(
            "delete from app.staff_memberships where user_id = any(%s::uuid[])",
            (user_ids,),
        )
        cursor.execute(
            "delete from app.student_profiles where user_id = any(%s::uuid[])",
            (user_ids,),
        )
        cursor.execute(
            "delete from app.user_profiles where user_id = any(%s::uuid[])",
            (user_ids,),
        )


def create_users(client: httpx.Client, supabase_url: str) -> None:
    for user_id, email in FIXTURES:
        response = client.post(
            f"{supabase_url}/auth/v1/admin/users",
            json={
                "id": user_id,
                "email": email,
                "password": PASSWORD,
                "email_confirm": True,
                "user_metadata": {"fixture": "identity-e2e"},
            },
        )
        response.raise_for_status()


def seed_identity_rows(database_url: str) -> None:
    with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            insert into app.user_profiles (user_id, email, name, phone)
            values
              (%s, %s, '승인 대기 교사', '01011112001'),
              (%s, %s, '승인 교사', '01011112002'),
              (%s, %s, '초기 관리자', '01011113001')
            on conflict (user_id) do update
            set email = excluded.email, name = excluded.name, phone = excluded.phone
            """,
            (
                FIXTURES[1][0],
                FIXTURES[1][1],
                FIXTURES[2][0],
                FIXTURES[2][1],
                FIXTURES[3][0],
                FIXTURES[3][1],
            ),
        )
        cursor.execute(
            """
            insert into app.teacher_applications (id, user_id, status)
            values ('00000000-0000-4000-8000-000000000401', %s, 'pending')
            """,
            (FIXTURES[1][0],),
        )
        cursor.execute(
            """
            insert into app.staff_memberships (user_id, role, approved_by)
            values (%s, 'admin', %s), (%s, 'teacher', %s)
            """,
            (
                FIXTURES[3][0],
                FIXTURES[3][0],
                FIXTURES[2][0],
                FIXTURES[3][0],
            ),
        )


def main() -> None:
    supabase_url, service_key, database_url = require_local_test_environment()
    action = sys.argv[1] if len(sys.argv) > 1 else "setup"
    with httpx.Client(headers=auth_headers(service_key), timeout=10.0) as client:
        remove_identity_rows(database_url)
        remove_users(client, supabase_url)
        if action == "setup":
            create_users(client, supabase_url)
            seed_identity_rows(database_url)
        elif action != "teardown":
            raise ValueError(f"Unknown fixture action: {action}")


if __name__ == "__main__":
    main()
