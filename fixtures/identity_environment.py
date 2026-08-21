import ipaddress
import os
from collections.abc import Iterable
from urllib.parse import urlsplit


def _is_loopback_url(value: str | None, allowed_schemes: frozenset[str]) -> bool:
    if not value:
        return False

    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
    except ValueError:
        return False

    if parsed.scheme.lower() not in allowed_schemes or not hostname:
        return False

    normalized_hostname = hostname.rstrip(".").lower()
    if normalized_hostname == "localhost":
        return True

    try:
        return ipaddress.ip_address(normalized_hostname).is_loopback
    except ValueError:
        return False


def require_local_identity_environment(
    *,
    supabase_url: str | None,
    database_urls: Iterable[str | None],
) -> None:
    if os.environ.get("APP_ENV") != "test":
        raise RuntimeError("Identity browser fixtures require APP_ENV=test.")
    if "VERCEL_ENV" in os.environ:
        raise RuntimeError("Identity browser fixtures cannot load on Vercel.")
    if not _is_loopback_url(supabase_url, frozenset({"http", "https"})):
        raise RuntimeError(
            "Identity browser fixtures require the local Supabase stack."
        )
    if any(
        not _is_loopback_url(database_url, frozenset({"postgres", "postgresql"}))
        for database_url in database_urls
    ):
        raise RuntimeError(
            "Identity browser fixtures require a local PostgreSQL database."
        )
