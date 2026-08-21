import tomllib
from pathlib import Path


def local_supabase_config() -> dict[str, object]:
    with Path("supabase/config.toml").open("rb") as config_file:
        return tomllib.load(config_file)


def test_local_email_signup_requires_confirmation() -> None:
    config = local_supabase_config()

    assert config["auth"]["email"]["enable_confirmations"] is True


def test_local_auth_allows_only_explicit_application_callback_urls() -> None:
    config = local_supabase_config()

    assert config["auth"]["additional_redirect_urls"] == [
        "http://127.0.0.1:3000/auth/callback",
        "http://localhost:3000/auth/callback",
    ]
