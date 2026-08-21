from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_publishable_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "SUPABASE_PUBLISHABLE_KEY",
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        ),
    )
    supabase_jwt_audience: str = "authenticated"
    supabase_jwks_url: str | None = None
    supabase_jwks_cache_ttl_seconds: int = 300
    database_url: str | None = None
    database_connect_timeout_seconds: int = Field(default=2, ge=1, le=5)
    database_statement_timeout_ms: int = Field(default=5000, ge=1, lt=8000)
    initial_admin_email: str | None = None
    kiosk_password_hash: SecretStr | None = None
    kiosk_cookie_secret: SecretStr | None = Field(default=None, min_length=32)
    allowed_frontend_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://127.0.0.1:3000",
            "http://localhost:3000",
        ]
    )
    app_timezone: Literal["Asia/Seoul"] = "Asia/Seoul"

    @field_validator("allowed_frontend_origins", mode="before")
    @classmethod
    def validate_allowed_frontend_origins(cls, value: object) -> list[str]:
        if isinstance(value, str):
            candidates = value.split(",")
        elif isinstance(value, (list, tuple)):
            candidates = list(value)
        else:
            raise TypeError("ALLOWED_FRONTEND_ORIGINS must be a comma-separated list")

        origins: list[str] = []
        for candidate in candidates:
            origin = str(candidate).strip()
            parsed = urlsplit(origin)
            try:
                parsed_port = parsed.port
            except ValueError as error:
                raise ValueError("ALLOWED_FRONTEND_ORIGINS contains an invalid port") from error
            if (
                origin == "*"
                or parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(
                    "ALLOWED_FRONTEND_ORIGINS must contain explicit HTTP origins"
                )
            normalized = f"{parsed.scheme}://{parsed.hostname}"
            if ":" in parsed.hostname and not parsed.hostname.startswith("["):
                normalized = f"{parsed.scheme}://[{parsed.hostname}]"
            if parsed_port is not None:
                normalized = f"{normalized}:{parsed_port}"
            if normalized not in origins:
                origins.append(normalized)

        if not origins:
            raise ValueError("ALLOWED_FRONTEND_ORIGINS must not be empty")
        return origins

    @field_validator("kiosk_password_hash")
    @classmethod
    def validate_kiosk_password_hash(
        cls, value: SecretStr | None
    ) -> SecretStr | None:
        if value is not None and not value.get_secret_value().startswith("$argon2id$"):
            raise ValueError("KIOSK_PASSWORD_HASH must be an Argon2id hash")
        return value

    @model_validator(mode="after")
    def validate_database_timeout_budget(self) -> Self:
        timeout_budget_ms = (
            self.database_connect_timeout_seconds * 1000
            + self.database_statement_timeout_ms
        )
        if timeout_budget_ms > 8000:
            raise ValueError("Database timeout budget must not exceed 8000ms")
        return self


settings = Settings()
