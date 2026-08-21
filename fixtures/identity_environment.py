import ipaddress
import os
from collections.abc import Iterable
from urllib.parse import urlsplit

from psycopg import ProgrammingError
from psycopg.conninfo import conninfo_to_dict

LIBPQ_DESTINATION_ENVIRONMENT = frozenset(
    {"PGHOST", "PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE"}
)


def _is_loopback_host(value: str, *, allow_localhost: bool) -> bool:
    normalized_value = value.strip().rstrip(".").lower()
    if not normalized_value:
        return False
    if allow_localhost and normalized_value == "localhost":
        return True

    try:
        return ipaddress.ip_address(normalized_value).is_loopback
    except ValueError:
        return False


def _is_loopback_supabase_url(value: str | None) -> bool:
    if not value:
        return False

    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
    except ValueError:
        return False

    if parsed.scheme.lower() not in {"http", "https"} or not hostname:
        return False

    return _is_loopback_host(hostname, allow_localhost=True)


def _all_destinations_are_loopback(
    value: str,
    *,
    allow_localhost: bool,
) -> bool:
    return all(
        _is_loopback_host(destination, allow_localhost=allow_localhost)
        for destination in value.split(",")
    )


def _is_loopback_database_dsn(value: str | None) -> bool:
    if not value:
        return False

    try:
        parameters = conninfo_to_dict(value)
    except ProgrammingError:
        return False

    if "service" in parameters or "servicefile" in parameters:
        return False

    host = parameters.get("host")
    hostaddr = parameters.get("hostaddr")
    if not host and not hostaddr:
        return False
    if host and not _all_destinations_are_loopback(host, allow_localhost=True):
        return False
    return not hostaddr or _all_destinations_are_loopback(
        hostaddr, allow_localhost=False
    )


def require_local_identity_environment(
    *,
    supabase_url: str | None,
    database_urls: Iterable[str | None],
) -> None:
    if os.environ.get("APP_ENV") != "test":
        raise RuntimeError("Identity browser fixtures require APP_ENV=test.")
    if "VERCEL_ENV" in os.environ:
        raise RuntimeError("Identity browser fixtures cannot load on Vercel.")
    if not _is_loopback_supabase_url(supabase_url):
        raise RuntimeError(
            "Identity browser fixtures require the local Supabase stack."
        )
    if any(name in os.environ for name in LIBPQ_DESTINATION_ENVIRONMENT):
        raise RuntimeError(
            "Identity browser fixtures require a local PostgreSQL database."
        )
    if any(
        not _is_loopback_database_dsn(database_url) for database_url in database_urls
    ):
        raise RuntimeError(
            "Identity browser fixtures require a local PostgreSQL database."
        )
