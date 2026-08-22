from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

import psycopg

from backend.core.config import settings

AsyncConnector = Callable[..., Awaitable[Any]]


@asynccontextmanager
async def application_transaction(
    *,
    database_url: str | None = None,
    connect_timeout_seconds: int | None = None,
    statement_timeout_ms: int | None = None,
    connect: AsyncConnector = psycopg.AsyncConnection.connect,
) -> AsyncIterator[Any]:
    resolved_database_url = database_url or settings.database_url
    if not resolved_database_url:
        raise RuntimeError("DATABASE_URL is required for database operations")
    resolved_connect_timeout = (
        settings.database_connect_timeout_seconds
        if connect_timeout_seconds is None
        else connect_timeout_seconds
    )
    resolved_statement_timeout = (
        settings.database_statement_timeout_ms
        if statement_timeout_ms is None
        else statement_timeout_ms
    )

    connection = await connect(
        resolved_database_url,
        connect_timeout=resolved_connect_timeout,
    )
    try:
        await connection.execute("set local role app_backend")
        await connection.execute(
            "select set_config('TimeZone', %s, true)",
            (settings.app_timezone,),
        )
        await connection.execute(
            "select set_config('statement_timeout', %s, true)",
            (f"{resolved_statement_timeout}ms",),
        )
        yield connection
        await connection.commit()
    except BaseException:
        await connection.rollback()
        raise
    finally:
        await connection.close()


async def get_database_connection() -> AsyncIterator[psycopg.AsyncConnection[Any]]:
    async with application_transaction() as connection:
        yield connection
