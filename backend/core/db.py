from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

import psycopg

from backend.core.config import settings

AsyncConnector = Callable[[str], Awaitable[Any]]


@asynccontextmanager
async def application_transaction(
    *,
    database_url: str | None = None,
    connect: AsyncConnector = psycopg.AsyncConnection.connect,
) -> AsyncIterator[Any]:
    resolved_database_url = database_url or settings.database_url
    if not resolved_database_url:
        raise RuntimeError("DATABASE_URL is required for database operations")

    connection = await connect(resolved_database_url)
    try:
        await connection.execute("set local role app_backend")
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
