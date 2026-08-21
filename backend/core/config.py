from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
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
    initial_admin_email: str | None = None


settings = Settings()
