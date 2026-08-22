from typing import Any
from uuid import UUID

import httpx
import pytest
from pydantic import BaseModel

from backend.core.db import application_transaction
from backend.main import app


class ValidationProbe(BaseModel):
    count: int


@app.post("/api/test/error-validation")
async def validation_probe(_payload: ValidationProbe) -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/test/unexpected-error")
async def unexpected_error_probe() -> None:
    raise RuntimeError("database-password=must-not-leak")


def assert_safe_error_envelope(
    response: httpx.Response, *, status_code: int, code: str
) -> None:
    assert response.status_code == status_code
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]
    UUID(response.headers["X-Request-ID"])
    assert set(response.json()["error"]) == {"code", "message", "request_id"}


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


async def test_request_validation_failure_uses_safe_error_envelope(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        "/api/test/error-validation", json={"count": "not-an-integer"}
    )

    assert_safe_error_envelope(
        response, status_code=422, code="VALIDATION_ERROR"
    )
    assert "not-an-integer" not in response.text


async def test_unknown_route_uses_safe_error_envelope(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/route-that-does-not-exist")

    assert_safe_error_envelope(response, status_code=404, code="NOT_FOUND")
    assert "detail" not in response.json()


async def test_wrong_method_uses_safe_error_envelope(
    client: httpx.AsyncClient,
) -> None:
    response = await client.delete("/api/health")

    assert_safe_error_envelope(
        response, status_code=405, code="METHOD_NOT_ALLOWED"
    )
    assert "detail" not in response.json()


async def test_unexpected_exception_uses_safe_error_envelope_without_internals() -> None:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as safe_client:
        response = await safe_client.get("/api/test/unexpected-error")

    assert_safe_error_envelope(
        response, status_code=500, code="INTERNAL_ERROR"
    )
    assert "database-password" not in response.text
    assert "RuntimeError" not in response.text


class RecordingConnection:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    async def execute(
        self, query: str, parameters: tuple[str, ...] | None = None
    ) -> None:
        event = query if parameters is None else f"{query}:{parameters[0]}"
        self.events.append(event)

    async def commit(self) -> None:
        self.events.append("commit")

    async def rollback(self) -> None:
        self.events.append("rollback")

    async def close(self) -> None:
        self.events.append("close")


def recording_connector(
    events: list[str],
) -> Any:
    async def connect(
        database_url: str, *, connect_timeout: int
    ) -> RecordingConnection:
        events.append(f"connect:{database_url}:timeout={connect_timeout}")
        return RecordingConnection(events)

    return connect


async def use_transaction(events: list[str], *, fail: bool) -> None:
    async with application_transaction(
        database_url="postgresql://database.test/app",
        connect_timeout_seconds=3,
        statement_timeout_ms=4000,
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
        "connect:postgresql://database.test/app:timeout=3",
        "set local role app_backend",
        "select set_config('TimeZone', %s, true):Asia/Seoul",
        "select set_config('statement_timeout', %s, true):4000ms",
        "application-query",
        "commit",
        "close",
    ]


async def test_application_transaction_rolls_back_and_closes_after_failure() -> None:
    events: list[str] = []

    with pytest.raises(RuntimeError, match="database detail"):
        await use_transaction(events, fail=True)

    assert events == [
        "connect:postgresql://database.test/app:timeout=3",
        "set local role app_backend",
        "select set_config('TimeZone', %s, true):Asia/Seoul",
        "select set_config('statement_timeout', %s, true):4000ms",
        "application-query",
        "rollback",
        "close",
    ]
