import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import httpx
import psycopg

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT))

from fixtures.identity_environment import require_local_identity_environment

FIXTURE_EMAIL = "email-confirmation.student@example.test"


def _is_loopback_http_url(value: str | None) -> bool:
    if not value:
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and parsed.hostname in {
        "127.0.0.1",
        "localhost",
        "::1",
    }


def require_local_email_confirmation_environment() -> tuple[str, str, str, str]:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    database_url = os.environ.get("TEST_DATABASE_URL")
    runtime_database_url = os.environ.get("DATABASE_URL")
    mailbox_url = os.environ.get("INBUCKET_URL")
    try:
        require_local_identity_environment(
            supabase_url=supabase_url,
            database_urls=(database_url, runtime_database_url),
        )
    except RuntimeError:
        raise RuntimeError(
            "Identity email-confirmation fixture requires a loopback-only test environment."
        ) from None
    if (
        not supabase_url
        or not service_key
        or not database_url
        or not _is_loopback_http_url(mailbox_url)
    ):
        raise RuntimeError(
            "Identity email-confirmation fixture requires local Supabase, database, and mail viewer endpoints."
        )
    return supabase_url.rstrip("/"), service_key, database_url, mailbox_url.rstrip("/")


def _fixture_user_id(
    client: httpx.Client,
    supabase_url: str,
    email: str,
) -> UUID | None:
    response = client.get(
        f"{supabase_url}/auth/v1/admin/users",
        params={"page": 1, "per_page": 1000},
    )
    response.raise_for_status()
    matches = [
        UUID(user["id"])
        for user in response.json().get("users", [])
        if user.get("email") == email
    ]
    if len(matches) > 1:
        raise RuntimeError("The local confirmation fixture email is not unique.")
    return matches[0] if matches else None


def _remove_application_rows(database_url: str, user_id: UUID) -> None:
    with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "delete from app.attendance_scans where student_id = %s",
            (user_id,),
        )
        cursor.execute("delete from app.audit_logs where actor_id = %s", (user_id,))
        cursor.execute("delete from app.events where created_by = %s", (user_id,))
        cursor.execute(
            "delete from app.teacher_applications where user_id = %s", (user_id,)
        )
        cursor.execute("delete from app.staff_memberships where user_id = %s", (user_id,))
        cursor.execute("delete from app.student_profiles where user_id = %s", (user_id,))
        cursor.execute("delete from app.user_profiles where user_id = %s", (user_id,))


def _remove_mail(mailbox_url: str, email: str) -> None:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(f"{mailbox_url}/api/v1/messages")
        response.raise_for_status()
        for message in response.json().get("messages", []):
            recipients = {
                recipient.get("Address")
                for recipient in message.get("To", [])
                if isinstance(recipient, dict)
            }
            if email not in recipients:
                continue
            delete_response = client.request(
                "DELETE",
                f"{mailbox_url}/api/v1/messages",
                json={"IDs": [message["ID"]]},
            )
            if delete_response.status_code not in {200, 204, 404}:
                delete_response.raise_for_status()


def cleanup(email: str) -> None:
    if email != FIXTURE_EMAIL:
        raise RuntimeError("Identity email-confirmation fixture requires its exact owned email.")
    supabase_url, service_key, database_url, mailbox_url = (
        require_local_email_confirmation_environment()
    )
    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
    with httpx.Client(headers=headers, timeout=10.0) as client:
        user_id = _fixture_user_id(client, supabase_url, email)
        if user_id is not None:
            _remove_application_rows(database_url, user_id)
            response = client.delete(f"{supabase_url}/auth/v1/admin/users/{user_id}")
            if response.status_code not in {200, 204, 404}:
                response.raise_for_status()
    _remove_mail(mailbox_url, email)


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    email = sys.argv[2] if len(sys.argv) > 2 else ""
    if action != "cleanup":
        raise ValueError("The email-confirmation fixture supports only cleanup.")
    cleanup(email)


if __name__ == "__main__":
    main()
