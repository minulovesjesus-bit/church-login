import os

import psycopg


def test_identity_tables_exist() -> None:
    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as connection:
        names = connection.execute(
            "select table_name from information_schema.tables where table_schema = 'app'"
        ).fetchall()
    assert {row[0] for row in names} >= {
        "user_profiles",
        "student_profiles",
        "teacher_applications",
        "staff_memberships",
        "audit_logs",
    }


def test_database_owner_can_assume_backend_role() -> None:
    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as connection:
        connection.execute("set local role app_backend")
        current_role = connection.execute("select current_user").fetchone()
    assert current_role == ("app_backend",)
