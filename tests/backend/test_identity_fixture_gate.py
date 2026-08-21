import os
import subprocess
import sys
from pathlib import Path

import pytest

SEED_FIXTURE_PATH = Path(__file__).parents[1] / "e2e" / "fixtures" / "identity_seed.py"
ATTENDANCE_AUDIT_FIXTURE_PATH = (
    Path(__file__).parents[1] / "e2e" / "fixtures" / "attendance_audit.py"
)
EMAIL_CONFIRMATION_FIXTURE_PATH = (
    Path(__file__).parents[1] / "e2e" / "fixtures" / "email_confirmation.py"
)
RUN_SEED_VALIDATION = (
    "import runpy; "
    f"runpy.run_path({str(SEED_FIXTURE_PATH)!r})"
    "['require_local_test_environment']()"
)
RUN_SEED_MAIN_WITHOUT_CONNECTIONS = (
    "import runpy; "
    f"fixture = runpy.run_path({str(SEED_FIXTURE_PATH)!r}); "
    "fixture['httpx'].Client = lambda *args, **kwargs: "
    "(_ for _ in ()).throw(AssertionError('connection attempted')); "
    "fixture['main']()"
)
IMPORT_THEN_INSTALL_AUTH_FIXTURE = """
from fastapi import FastAPI
from backend.core.config import settings
from fixtures.identity_auth import install_identity_auth_fixtures

settings.database_url = (
    "postgresql://fixture:attachment-secret@db.example.com:5432/postgres"
)
install_identity_auth_fixtures(FastAPI())
"""
ATTEMPT_AUTH_FIXTURE_INSTALL = """
from fastapi import FastAPI

app = FastAPI()
try:
    from fixtures.identity_auth import install_identity_auth_fixtures
    install_identity_auth_fixtures(app)
except RuntimeError:
    if app.dependency_overrides:
        raise AssertionError("auth override attached")
    raise
"""
LIBPQ_DESTINATION_ENVIRONMENT_NAMES = (
    "PGHOST",
    "PGHOSTADDR",
    "PGSERVICE",
    "PGSERVICEFILE",
)
LIBPQ_DESTINATION_ENVIRONMENT = [
    pytest.param("PGHOST", "ambient-secret.db.example.com", id="pghost"),
    pytest.param("PGHOSTADDR", "203.0.113.10", id="pghostaddr"),
    pytest.param("PGSERVICE", "ambient-secret-service", id="pgservice"),
    pytest.param(
        "PGSERVICEFILE",
        "/tmp/ambient-secret-service.conf",
        id="pgservicefile",
    ),
    pytest.param("PGHOST", "", id="present-empty-pghost"),
]
LIBPQ_DESTINATION_BYPASSES = [
    pytest.param(
        (
            "postgresql://fixture:query-secret@127.0.0.1:54322/postgres"
            "?host=db.example.com"
        ),
        id="query-host",
    ),
    pytest.param(
        (
            "postgresql://fixture:query-secret@127.0.0.1:54322/postgres"
            "?hostaddr=203.0.113.10"
        ),
        id="query-hostaddr",
    ),
    pytest.param(
        (
            "postgresql://fixture:query-secret@127.0.0.1:54322/postgres"
            "?service=remote-db"
        ),
        id="service",
    ),
    pytest.param(
        (
            "postgresql://fixture:query-secret@127.0.0.1:54322/postgres"
            "?servicefile=/tmp/remote-service.conf"
        ),
        id="servicefile",
    ),
    pytest.param(
        (
            "postgresql://fixture:query-secret@127.0.0.1:54322,"
            "db.example.com:5432/postgres"
        ),
        id="authority-multi-host",
    ),
    pytest.param(
        (
            "postgresql://fixture:query-secret@127.0.0.1:54322/postgres"
            "?host=127.0.0.1%2Cdb.example.com"
        ),
        id="query-multi-host",
    ),
    pytest.param(
        (
            "postgresql://fixture:query-secret@127.0.0.1:54322/postgres"
            "?hostaddr=127.0.0.1%2C203.0.113.10"
        ),
        id="query-multi-hostaddr",
    ),
]


def fixture_environment(**overrides: str | None) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(
        {
            "APP_ENV": "test",
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "SUPABASE_SERVICE_ROLE_KEY": "local-fixture-service-key",
            "TEST_DATABASE_URL": (
                "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
            ),
            "DATABASE_URL": ("postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
        }
    )
    environment.pop("VERCEL", None)
    environment.pop("VERCEL_ENV", None)
    for name in LIBPQ_DESTINATION_ENVIRONMENT_NAMES:
        environment.pop(name, None)
    for name, value in overrides.items():
        if value is None:
            environment.pop(name, None)
        else:
            environment[name] = value
    return environment


def run_identity_auth_import(
    environment: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", "import fixtures.identity_auth"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )


def run_seed_validation(
    environment: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", RUN_SEED_VALIDATION],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )


def test_identity_auth_fixture_refuses_to_load_outside_test_environment() -> None:
    result = run_identity_auth_import(fixture_environment(APP_ENV="production"))

    assert result.returncode != 0
    assert "Identity browser fixtures require APP_ENV=test." in result.stderr


@pytest.mark.parametrize(
    ("marker", "value"),
    [("VERCEL", "1"), ("VERCEL", ""), ("VERCEL_ENV", "production"), ("VERCEL_ENV", "")],
)
def test_identity_auth_fixture_refuses_to_load_in_vercel_environment(
    marker: str,
    value: str,
) -> None:
    result = run_identity_auth_import(fixture_environment(**{marker: value}))

    assert result.returncode != 0
    assert "Identity browser fixtures cannot load on Vercel." in result.stderr


def test_identity_auth_fixture_refuses_remote_supabase_endpoint() -> None:
    result = run_identity_auth_import(
        fixture_environment(
            SUPABASE_URL="https://fixture:supabase-secret@project.supabase.co"
        )
    )

    assert result.returncode != 0
    assert "local Supabase stack" in result.stderr
    assert "supabase-secret" not in result.stderr


@pytest.mark.parametrize(
    ("supabase_url", "database_url"),
    [
        (
            "http://localhost:54321",
            "postgresql://postgres:postgres@localhost:54322/postgres",
        ),
        (
            "http://127.0.0.1:54321",
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        ),
        (
            "http://[::1]:54321",
            "postgresql://postgres:postgres@[::1]:54322/postgres",
        ),
        (
            "http://localhost:54321",
            ("postgresql://postgres:postgres@localhost:54322,127.0.0.1:54322/postgres"),
        ),
        (
            "http://localhost:54321",
            (
                "postgresql://postgres:postgres@localhost:54322/postgres"
                "?hostaddr=127.0.0.1"
            ),
        ),
    ],
)
def test_identity_auth_fixture_accepts_only_supported_loopback_endpoints(
    supabase_url: str,
    database_url: str,
) -> None:
    result = run_identity_auth_import(
        fixture_environment(
            SUPABASE_URL=supabase_url,
            DATABASE_URL=database_url,
        )
    )

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://fixture:remote-secret@db.example.com:5432/postgres",
        None,
    ],
)
def test_identity_auth_fixture_rejects_remote_or_missing_runtime_database(
    database_url: str | None,
) -> None:
    result = run_identity_auth_import(fixture_environment(DATABASE_URL=database_url))

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "remote-secret" not in result.stderr


def test_identity_auth_fixture_rejects_malformed_database_dsn() -> None:
    result = run_identity_auth_import(
        fixture_environment(
            DATABASE_URL="postgresql://fixture:parser-secret@[::1/postgres"
        )
    )

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "parser-secret" not in result.stderr


@pytest.mark.parametrize("database_url", LIBPQ_DESTINATION_BYPASSES)
def test_identity_auth_fixture_rejects_libpq_destination_bypasses(
    database_url: str,
) -> None:
    result = run_identity_auth_import(fixture_environment(DATABASE_URL=database_url))

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "query-secret" not in result.stderr


@pytest.mark.parametrize(
    ("environment_name", "environment_value"), LIBPQ_DESTINATION_ENVIRONMENT
)
def test_identity_auth_fixture_rejects_ambient_libpq_destination_before_override(
    environment_name: str,
    environment_value: str,
) -> None:
    result = subprocess.run(
        [sys.executable, "-c", ATTEMPT_AUTH_FIXTURE_INSTALL],
        capture_output=True,
        check=False,
        env=fixture_environment(**{environment_name: environment_value}),
        text=True,
    )

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "auth override attached" not in result.stderr
    if environment_value:
        assert environment_value not in result.stderr


def test_identity_auth_fixture_revalidates_before_attaching_override() -> None:
    result = subprocess.run(
        [sys.executable, "-c", IMPORT_THEN_INSTALL_AUTH_FIXTURE],
        capture_output=True,
        check=False,
        env=fixture_environment(),
        text=True,
    )

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "attachment-secret" not in result.stderr


@pytest.mark.parametrize(
    ("test_database_url", "runtime_database_url"),
    [
        (
            "postgresql://fixture:remote-secret@db.example.com:5432/postgres",
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        ),
        (
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
            "postgresql://fixture:remote-secret@db.example.com:5432/postgres",
        ),
        (
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
            None,
        ),
    ],
)
def test_seed_fixture_rejects_remote_or_missing_database_before_main(
    test_database_url: str,
    runtime_database_url: str | None,
) -> None:
    result = run_seed_validation(
        fixture_environment(
            TEST_DATABASE_URL=test_database_url,
            DATABASE_URL=runtime_database_url,
        )
    )

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "remote-secret" not in result.stderr


def test_seed_fixture_rejects_malformed_database_dsn_before_main() -> None:
    result = run_seed_validation(
        fixture_environment(
            TEST_DATABASE_URL="postgresql://fixture:parser-secret@[::1/postgres"
        )
    )

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "parser-secret" not in result.stderr


@pytest.mark.parametrize("database_url", LIBPQ_DESTINATION_BYPASSES)
def test_seed_fixture_rejects_libpq_destination_bypasses_before_main(
    database_url: str,
) -> None:
    result = run_seed_validation(fixture_environment(TEST_DATABASE_URL=database_url))

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "query-secret" not in result.stderr


@pytest.mark.parametrize(
    ("environment_name", "environment_value"), LIBPQ_DESTINATION_ENVIRONMENT
)
def test_seed_fixture_rejects_ambient_libpq_destination_before_connections(
    environment_name: str,
    environment_value: str,
) -> None:
    result = subprocess.run(
        [sys.executable, "-c", RUN_SEED_MAIN_WITHOUT_CONNECTIONS],
        capture_output=True,
        check=False,
        env=fixture_environment(**{environment_name: environment_value}),
        text=True,
    )

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "connection attempted" not in result.stderr
    if environment_value:
        assert environment_value not in result.stderr


def test_seed_fixture_rejects_remote_database_before_any_connection() -> None:
    result = subprocess.run(
        [sys.executable, "-c", RUN_SEED_MAIN_WITHOUT_CONNECTIONS],
        capture_output=True,
        check=False,
        env=fixture_environment(
            TEST_DATABASE_URL=(
                "postgresql://fixture:ordering-secret@db.example.com:5432/postgres"
            )
        ),
        text=True,
    )

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "connection attempted" not in result.stderr
    assert "ordering-secret" not in result.stderr


def test_seed_fixture_rejects_remote_supabase_endpoint() -> None:
    result = run_seed_validation(
        fixture_environment(
            SUPABASE_URL="https://fixture:supabase-secret@project.supabase.co"
        )
    )

    assert result.returncode != 0
    assert "local Supabase stack" in result.stderr
    assert "supabase-secret" not in result.stderr


def test_attendance_audit_fixture_refuses_production_environment() -> None:
    result = subprocess.run(
        [sys.executable, str(ATTENDANCE_AUDIT_FIXTURE_PATH)],
        capture_output=True,
        check=False,
        env=fixture_environment(APP_ENV="production"),
        text=True,
    )

    assert result.returncode != 0
    assert "Identity browser fixtures require APP_ENV=test." in result.stderr


@pytest.mark.parametrize(
    ("marker", "value"),
    [("VERCEL", "1"), ("VERCEL", ""), ("VERCEL_ENV", "production"), ("VERCEL_ENV", "")],
)
def test_attendance_audit_fixture_refuses_vercel(marker: str, value: str) -> None:
    result = subprocess.run(
        [sys.executable, str(ATTENDANCE_AUDIT_FIXTURE_PATH)],
        capture_output=True,
        check=False,
        env=fixture_environment(**{marker: value}),
        text=True,
    )

    assert result.returncode != 0
    assert "Identity browser fixtures cannot load on Vercel." in result.stderr


@pytest.mark.parametrize(
    "override",
    [
        {"SUPABASE_URL": "https://project.supabase.co"},
        {
            "TEST_DATABASE_URL": (
                "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
                "?host=db.example.com"
            )
        },
        {"PGSERVICE": "remote-service"},
    ],
)
def test_attendance_audit_fixture_refuses_hosted_or_overridden_destinations(
    override: dict[str, str],
) -> None:
    result = subprocess.run(
        [sys.executable, str(ATTENDANCE_AUDIT_FIXTURE_PATH)],
        capture_output=True,
        check=False,
        env=fixture_environment(**override),
        text=True,
    )

    assert result.returncode != 0
    assert "Identity browser fixtures require" in result.stderr


def test_seed_script_reaches_environment_gate_when_invoked_by_file_path() -> None:
    result = subprocess.run(
        [sys.executable, str(SEED_FIXTURE_PATH), "setup"],
        capture_output=True,
        check=False,
        env=fixture_environment(APP_ENV="production"),
        text=True,
    )

    assert result.returncode != 0
    assert "Identity browser fixtures require APP_ENV=test." in result.stderr
    assert "ModuleNotFoundError" not in result.stderr


@pytest.mark.parametrize(
    "override",
    [
        {"APP_ENV": "production"},
        {"VERCEL": "1"},
        {"SUPABASE_URL": "https://project.supabase.co"},
        {"INBUCKET_URL": "https://mail.example.com"},
    ],
)
def test_email_confirmation_cleanup_refuses_nonlocal_destinations_before_connections(
    override: dict[str, str],
) -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(EMAIL_CONFIRMATION_FIXTURE_PATH),
            "cleanup",
            "email-confirmation.student@example.test",
        ],
        capture_output=True,
        check=False,
        env=fixture_environment(
            **{"INBUCKET_URL": "http://127.0.0.1:54324", **override}
        ),
        text=True,
    )

    assert result.returncode != 0
    assert "Identity email-confirmation fixture requires" in result.stderr
    assert "mail.example.com" not in result.stderr


@pytest.mark.parametrize(
    ("marker", "value"),
    [("VERCEL", "1"), ("VERCEL", ""), ("VERCEL_ENV", "preview"), ("VERCEL_ENV", "")],
)
def test_seed_fixture_rejects_vercel_before_main(marker: str, value: str) -> None:
    result = run_seed_validation(fixture_environment(**{marker: value}))

    assert result.returncode != 0
    assert "cannot load on Vercel" in result.stderr


@pytest.mark.parametrize(
    ("supabase_url", "database_url"),
    [
        (
            "http://localhost:54321",
            "postgresql://postgres:postgres@localhost:54322/postgres",
        ),
        (
            "http://127.0.0.1:54321",
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        ),
        (
            "http://[::1]:54321",
            "postgresql://postgres:postgres@[::1]:54322/postgres",
        ),
        (
            "http://localhost:54321",
            ("postgresql://postgres:postgres@localhost:54322,127.0.0.1:54322/postgres"),
        ),
        (
            "http://localhost:54321",
            (
                "postgresql://postgres:postgres@localhost:54322/postgres"
                "?hostaddr=127.0.0.1"
            ),
        ),
    ],
)
def test_seed_fixture_accepts_supported_loopback_endpoints(
    supabase_url: str,
    database_url: str,
) -> None:
    result = run_seed_validation(
        fixture_environment(
            SUPABASE_URL=supabase_url,
            TEST_DATABASE_URL=database_url,
            DATABASE_URL=database_url,
        )
    )

    assert result.returncode == 0, result.stderr
