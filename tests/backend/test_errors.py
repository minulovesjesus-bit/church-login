from typing import Any
from uuid import UUID

import httpx
import pytest

from backend.core.db import application_transaction


async def test_missing_credentials_use_safe_error_envelope(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/me")

    assert response.status_code == 401
    assert response.json()["error"] == {
        "code": "AUTH_REQUIRED",
        "message": "로그인이 필요합니다.",
        "request_id": response.headers["X-Request-ID"],
    }
    UUID(response.json()["error"]["request_id"])
    assert "detail" not in response.json()


async def test_malformed_token_does_not_expose_exception_internals(
    client: httpx.AsyncClient,
) -> None:
    secret = "postgres-password=do-not-leak"

    response = await client.get(
        "/api/me", headers={"Authorization": f"Bearer {secret}"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
    assert secret not in response.text
    assert "DecodeError" not in response.text


class RecordingConnection:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    async def execute(self, query: str) -> None:
        self.events.append(query)

    async def commit(self) -> None:
        self.events.append("commit")

    async def rollback(self) -> None:
        self.events.append("rollback")

    async def close(self) -> None:
        self.events.append("close")


def recording_connector(
    events: list[str],
) -> Any:
    async def connect(database_url: str) -> RecordingConnection:
        events.append(f"connect:{database_url}")
        return RecordingConnection(events)

    return connect


async def use_transaction(events: list[str], *, fail: bool) -> None:
    async with application_transaction(
        database_url="postgresql://database.test/app",
        connect=recording_connector(events),
    ):
        events.append("application-query")
        if fail:
            raise RuntimeError("database detail")


async def test_application_transaction_sets_backend_role_before_work_and_commits(
) -> None:
    events: list[str] = []

    await use_transaction(events, fail=False)

    assert events == [
        "connect:postgresql://database.test/app",
        "set local role app_backend",
        "application-query",
        "commit",
        "close",
    ]


async def test_application_transaction_rolls_back_and_closes_after_failure() -> None:
    events: list[str] = []

    with pytest.raises(RuntimeError, match="database detail"):
        await use_transaction(events, fail=True)

    assert events == [
        "connect:postgresql://database.test/app",
        "set local role app_backend",
        "application-query",
        "rollback",
        "close",
    ]
