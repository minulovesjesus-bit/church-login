import os
import subprocess
import sys


def test_identity_auth_fixture_refuses_to_load_outside_test_environment() -> None:
    environment = os.environ.copy()
    environment["APP_ENV"] = "production"
    result = subprocess.run(
        [sys.executable, "-c", "import fixtures.identity_auth"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert "Identity browser fixtures require APP_ENV=test." in result.stderr


def test_identity_auth_fixture_refuses_to_load_in_vercel_environment() -> None:
    environment = os.environ.copy()
    environment["APP_ENV"] = "test"
    environment["SUPABASE_URL"] = "http://127.0.0.1:54321"
    environment["VERCEL_ENV"] = "production"
    result = subprocess.run(
        [sys.executable, "-c", "import fixtures.identity_auth"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert "Identity browser fixtures cannot load on Vercel." in result.stderr
