import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.core.config import Settings


def test_settings_load_dotenv_local_after_dotenv_and_before_process_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".env").write_text(
        "SUPABASE_URL=http://127.0.0.1:61001\nDATABASE_URL=postgresql://dotenv/base\n",
        encoding="utf-8",
    )
    (tmp_path / ".env.local").write_text(
        "SUPABASE_URL=http://127.0.0.1:61002\nDATABASE_URL=postgresql://dotenv/local\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://process/environment")
    monkeypatch.delenv("SUPABASE_URL", raising=False)

    loaded = Settings()

    assert loaded.supabase_url == "http://127.0.0.1:61002"
    assert loaded.database_url == "postgresql://process/environment"


def test_direct_uvicorn_import_loads_documented_dotenv_local_values(
    tmp_path: Path,
) -> None:
    (tmp_path / ".env.local").write_text(
        """APP_ENV=development
SUPABASE_URL=http://127.0.0.1:61003
DATABASE_CONNECT_TIMEOUT_SECONDS=4
DATABASE_STATEMENT_TIMEOUT_MS=3000
ALLOWED_FRONTEND_ORIGINS=http://127.0.0.1:3100
APP_TIMEZONE=Asia/Seoul
""",
        encoding="utf-8",
    )
    repository_root = Path(__file__).resolve().parents[2]
    environment = os.environ.copy()
    for variable in (
        "APP_ENV",
        "SUPABASE_URL",
        "DATABASE_CONNECT_TIMEOUT_SECONDS",
        "DATABASE_STATEMENT_TIMEOUT_MS",
        "ALLOWED_FRONTEND_ORIGINS",
        "APP_TIMEZONE",
    ):
        environment.pop(variable, None)
    environment["PYTHONPATH"] = os.pathsep.join(
        filter(None, [str(repository_root), environment.get("PYTHONPATH")])
    )

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import json; "
                "from api.index import app; "
                "from backend.core.config import settings; "
                "print(json.dumps({"
                "'title': app.title, "
                "'supabase_url': settings.supabase_url, "
                "'connect_timeout': settings.database_connect_timeout_seconds, "
                "'statement_timeout': settings.database_statement_timeout_ms"
                "}))"
            ),
        ],
        cwd=tmp_path,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    assert json.loads(result.stdout) == {
        "title": "Church Attendance API",
        "supabase_url": "http://127.0.0.1:61003",
        "connect_timeout": 4,
        "statement_timeout": 3000,
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("database_connect_timeout_seconds", 0),
        ("database_connect_timeout_seconds", 11),
        ("database_statement_timeout_ms", 0),
        ("database_statement_timeout_ms", 10_000),
    ],
)
def test_database_timeouts_are_bounded_for_short_requests(
    field: str, value: int
) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})


def test_database_timeout_budget_stays_below_the_short_request_ceiling() -> None:
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            database_connect_timeout_seconds=4,
            database_statement_timeout_ms=5000,
        )


def test_allowed_frontend_origins_are_explicit_and_normalized() -> None:
    loaded = Settings(
        _env_file=None,
        allowed_frontend_origins=(
            "http://127.0.0.1:3000, https://church.example.test"
        ),
    )

    assert loaded.allowed_frontend_origins == [
        "http://127.0.0.1:3000",
        "https://church.example.test",
    ]


@pytest.mark.parametrize(
    "origins",
    [
        "*",
        "https://church.example.test/path",
        "https://user:password@church.example.test",
    ],
)
def test_allowed_frontend_origins_reject_unsafe_values(origins: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, allowed_frontend_origins=origins)


def test_application_timezone_is_fixed_to_seoul() -> None:
    assert Settings(_env_file=None).app_timezone == "Asia/Seoul"

    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_timezone="UTC")


def test_kiosk_secrets_are_redacted_and_validated() -> None:
    configured = Settings(
        _env_file=None,
        kiosk_password_hash="$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
        kiosk_cookie_secret="s" * 32,
    )

    assert configured.kiosk_password_hash is not None
    assert configured.kiosk_cookie_secret is not None
    assert "argon2id" not in repr(configured.kiosk_password_hash)
    assert configured.kiosk_cookie_secret.get_secret_value() == "s" * 32

    with pytest.raises(ValidationError):
        Settings(_env_file=None, kiosk_password_hash="plain-text-password")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, kiosk_cookie_secret="too-short")


def test_kiosk_cookies_are_secure_by_default_even_in_development() -> None:
    assert Settings(_env_file=None, app_env="development").kiosk_cookies_secure()


def test_insecure_kiosk_cookies_require_explicit_loopback_local_mode() -> None:
    local = Settings(
        _env_file=None,
        app_env="development",
        kiosk_insecure_local_cookies=True,
        allowed_frontend_origins="http://127.0.0.1:3000,http://localhost:3000",
    )
    non_loopback = Settings(
        _env_file=None,
        app_env="development",
        kiosk_insecure_local_cookies=True,
        allowed_frontend_origins="https://church.example.test",
    )
    production = Settings(
        _env_file=None,
        app_env="production",
        kiosk_insecure_local_cookies=True,
    )

    assert local.kiosk_cookies_secure() is False
    assert non_loopback.kiosk_cookies_secure() is True
    assert production.kiosk_cookies_secure() is True


@pytest.mark.parametrize(
    "vercel_marker",
    [
        {"vercel": "1"},
        {"vercel_env": "preview"},
    ],
)
def test_vercel_markers_force_secure_kiosk_cookies(
    vercel_marker: dict[str, str],
) -> None:
    configured = Settings(
        _env_file=None,
        app_env="development",
        kiosk_insecure_local_cookies=True,
        **vercel_marker,
    )

    assert configured.kiosk_cookies_secure() is True
