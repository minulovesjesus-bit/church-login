import os
import subprocess
import sys
from pathlib import Path

import pytest

SEED_FIXTURE_PATH = Path(__file__).parents[1] / "e2e" / "fixtures" / "identity_seed.py"
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
    environment.pop("VERCEL_ENV", None)
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


@pytest.mark.parametrize("vercel_env", ["production", ""])
def test_identity_auth_fixture_refuses_to_load_in_vercel_environment(
    vercel_env: str,
) -> None:
    result = run_identity_auth_import(fixture_environment(VERCEL_ENV=vercel_env))

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


@pytest.mark.parametrize("database_url", LIBPQ_DESTINATION_BYPASSES)
def test_identity_auth_fixture_rejects_libpq_destination_bypasses(
    database_url: str,
) -> None:
    result = run_identity_auth_import(fixture_environment(DATABASE_URL=database_url))

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "query-secret" not in result.stderr


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


@pytest.mark.parametrize("database_url", LIBPQ_DESTINATION_BYPASSES)
def test_seed_fixture_rejects_libpq_destination_bypasses_before_main(
    database_url: str,
) -> None:
    result = run_seed_validation(fixture_environment(TEST_DATABASE_URL=database_url))

    assert result.returncode != 0
    assert "local PostgreSQL database" in result.stderr
    assert "query-secret" not in result.stderr


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


@pytest.mark.parametrize("vercel_env", ["preview", ""])
def test_seed_fixture_rejects_vercel_before_main(vercel_env: str) -> None:
    result = run_seed_validation(fixture_environment(VERCEL_ENV=vercel_env))

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
