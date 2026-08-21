from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest

from backend.core.config import settings
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser
from backend.identity.router import require_admin
from backend.kiosk.repository import KioskSessionRecord
from backend.kiosk.router import get_kiosk_service
from backend.kiosk.schemas import IssuedQrChallenge, KioskTokens, QrChallenge
from backend.kiosk.service import KioskSessionRevoked
from backend.main import app


class FakeKioskService:
    def __init__(self) -> None:
        self.login_calls: list[tuple[str, str]] = []
        self.refresh_calls: list[str] = []
        self.revoke_calls: list[str] = []
        self.require_access_calls: list[str] = []
        self.issue_qr_calls: list[UUID] = []
        self.admin_revoke_calls: list[tuple[UUID, UUID]] = []
        self.now = datetime(2026, 8, 21, 1, tzinfo=UTC)
        self.session_id = uuid4()
        self.reject_login = False
        self.reject_access = False

    def tokens(self) -> KioskTokens:
        return KioskTokens(
            session_id=self.session_id,
            access_token="signed-access-token",
            access_expires_at=self.now + timedelta(minutes=15),
            refresh_token="opaque-refresh-token",
            refresh_expires_at=self.now + timedelta(days=30),
        )

    async def login(self, password: str, rate_limit_key_hash: str) -> KioskTokens:
        self.login_calls.append((password, rate_limit_key_hash))
        if self.reject_login:
            from backend.kiosk.service import KioskLoginRejected

            raise KioskLoginRejected
        return self.tokens()

    async def refresh(self, refresh_token: str) -> KioskTokens:
        self.refresh_calls.append(refresh_token)
        return self.tokens()

    async def revoke(self, access_token: str) -> None:
        self.revoke_calls.append(access_token)

    async def require_access(self, access_token: str) -> KioskSessionRecord:
        self.require_access_calls.append(access_token)
        if self.reject_access:
            raise KioskSessionRevoked
        return KioskSessionRecord(
            id=self.session_id,
            created_at=self.now,
            last_seen_at=self.now,
            refresh_expires_at=self.now + timedelta(days=30),
            revoked_at=None,
        )

    def issue_qr_challenge(self, session_id: UUID) -> IssuedQrChallenge:
        self.issue_qr_calls.append(session_id)
        challenge = QrChallenge(
            kiosk_session_id=session_id,
            issued_at=self.now,
            expires_at=self.now + timedelta(seconds=20),
            nonce=uuid4(),
        )
        return IssuedQrChallenge(token="signed-attendance-qr", challenge=challenge)

    async def admin_sessions(self):
        return [
            {
                "session_id": self.session_id,
                "created_at": self.now,
                "last_seen_at": self.now,
                "refresh_expires_at": self.now + timedelta(days=30),
                "revoked_at": None,
            }
        ]

    async def revoke_as_admin(self, session_id: UUID, actor_id: UUID) -> None:
        self.admin_revoke_calls.append((session_id, actor_id))


@pytest.fixture
def kiosk_api() -> AsyncIterator[FakeKioskService]:
    service = FakeKioskService()
    app.dependency_overrides[get_kiosk_service] = lambda: service
    try:
        yield service
    finally:
        app.dependency_overrides.clear()


async def test_login_sets_strict_httponly_cookies_without_exposing_tokens(
    client: httpx.AsyncClient, kiosk_api: FakeKioskService
) -> None:
    origin = settings.allowed_frontend_origins[0]
    response = await client.post(
        "/api/kiosk/sessions",
        json={"password": "church-kiosk-secret"},
        headers={"Origin": origin, "User-Agent": "Church Tablet"},
    )

    assert response.status_code == 201
    assert "access_token" not in response.text
    assert "refresh_token" not in response.text
    cookies = response.headers.get_list("set-cookie")
    assert any(
        value.startswith("kiosk_access=signed-access-token;")
        and "HttpOnly" in value
        and "SameSite=strict" in value
        and "Path=/" in value
        for value in cookies
    )
    assert any(
        value.startswith("kiosk_refresh=opaque-refresh-token;")
        and "HttpOnly" in value
        and "SameSite=strict" in value
        and "Path=/" in value
        for value in cookies
    )
    assert kiosk_api.login_calls[0][0] == "church-kiosk-secret"
    assert "127.0.0.1" not in kiosk_api.login_calls[0][1]
    assert "Church Tablet" not in kiosk_api.login_calls[0][1]


@pytest.mark.parametrize(
    ("method", "path", "cookies", "json"),
    [
        ("POST", "/api/kiosk/sessions", {}, {"password": "secret"}),
        (
            "POST",
            "/api/kiosk/sessions/refresh",
            {"kiosk_refresh": "opaque-refresh-token"},
            None,
        ),
        (
            "DELETE",
            "/api/kiosk/sessions/current",
            {"kiosk_access": "signed-access-token"},
            None,
        ),
    ],
)
async def test_cookie_mutations_reject_untrusted_or_missing_origin(
    client: httpx.AsyncClient,
    kiosk_api: FakeKioskService,
    method: str,
    path: str,
    cookies: dict[str, str],
    json: dict[str, str] | None,
) -> None:
    response = await client.request(
        method,
        path,
        json=json,
        headers={
            "Origin": "https://attacker.example.test",
            "Cookie": "; ".join(f"{key}={value}" for key, value in cookies.items()),
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ORIGIN_NOT_ALLOWED"


async def test_refresh_rotates_both_cookies(
    client: httpx.AsyncClient, kiosk_api: FakeKioskService
) -> None:
    response = await client.post(
        "/api/kiosk/sessions/refresh",
        headers={
            "Origin": settings.allowed_frontend_origins[0],
            "Cookie": "kiosk_refresh=old-refresh",
        },
    )

    assert response.status_code == 200
    assert kiosk_api.refresh_calls == ["old-refresh"]
    cookies = response.headers.get_list("set-cookie")
    assert any(value.startswith("kiosk_access=signed-access-token;") for value in cookies)
    assert any(value.startswith("kiosk_refresh=opaque-refresh-token;") for value in cookies)


async def test_login_failure_keeps_safe_message_and_allows_rate_limit_commit(
    client: httpx.AsyncClient,
) -> None:
    service = FakeKioskService()
    service.reject_login = True
    dependency_finished = False

    async def rejected_service() -> AsyncIterator[FakeKioskService]:
        nonlocal dependency_finished
        yield service
        dependency_finished = True

    app.dependency_overrides[get_kiosk_service] = rejected_service
    try:
        response = await client.post(
            "/api/kiosk/sessions",
            json={"password": "wrong"},
            headers={"Origin": settings.allowed_frontend_origins[0]},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "KIOSK_LOGIN_FAILED"
    assert response.json()["error"]["message"] == "관리자 비밀번호를 확인해 주세요."
    assert dependency_finished is True


async def test_production_cookies_are_secure(
    client: httpx.AsyncClient,
    kiosk_api: FakeKioskService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    response = await client.post(
        "/api/kiosk/sessions",
        json={"password": "church-kiosk-secret"},
        headers={"Origin": settings.allowed_frontend_origins[0]},
    )

    assert response.status_code == 201
    assert all("Secure" in value for value in response.headers.get_list("set-cookie"))


@pytest.mark.parametrize(
    ("marker", "value"),
    [("vercel", "1"), ("vercel_env", "preview")],
)
async def test_vercel_markers_force_secure_response_cookies(
    client: httpx.AsyncClient,
    kiosk_api: FakeKioskService,
    monkeypatch: pytest.MonkeyPatch,
    marker: str,
    value: str,
) -> None:
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "kiosk_insecure_local_cookies", True)
    monkeypatch.setattr(settings, marker, value)
    response = await client.post(
        "/api/kiosk/sessions",
        json={"password": "church-kiosk-secret"},
        headers={"Origin": settings.allowed_frontend_origins[0]},
    )

    assert response.status_code == 201
    assert all("Secure" in cookie for cookie in response.headers.get_list("set-cookie"))


async def test_logout_revokes_and_clears_both_cookies(
    client: httpx.AsyncClient, kiosk_api: FakeKioskService
) -> None:
    response = await client.delete(
        "/api/kiosk/sessions/current",
        headers={
            "Origin": settings.allowed_frontend_origins[0],
            "Cookie": "kiosk_access=signed-access-token",
        },
    )

    assert response.status_code == 204
    assert kiosk_api.revoke_calls == ["signed-access-token"]
    cookies = response.headers.get_list("set-cookie")
    assert any(value.startswith('kiosk_access="";') and "Max-Age=0" in value for value in cookies)
    assert any(value.startswith('kiosk_refresh="";') and "Max-Age=0" in value for value in cookies)


async def test_missing_cookie_uses_stable_safe_error_envelope(
    client: httpx.AsyncClient, kiosk_api: FakeKioskService
) -> None:
    response = await client.post(
        "/api/kiosk/sessions/refresh",
        headers={"Origin": settings.allowed_frontend_origins[0]},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "KIOSK_SESSION_REVOKED"
    assert response.json()["error"]["request_id"]


async def test_qr_endpoint_requires_active_cookie_and_returns_only_challenge_fields(
    client: httpx.AsyncClient,
    kiosk_api: FakeKioskService,
) -> None:
    response = await client.get(
        "/api/kiosk/qr",
        headers={"Cookie": "kiosk_access=signed-access-token"},
    )

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json() == {
        "token": "signed-attendance-qr",
        "issued_at": "2026-08-21T01:00:00Z",
        "expires_at": "2026-08-21T01:00:20Z",
    }
    assert kiosk_api.require_access_calls == ["signed-access-token"]
    assert kiosk_api.issue_qr_calls == [kiosk_api.session_id]
    assert "student" not in response.text.lower()
    assert "nonce" not in response.text.lower()


async def test_qr_endpoint_rejects_missing_kiosk_cookie(
    client: httpx.AsyncClient,
    kiosk_api: FakeKioskService,
) -> None:
    response = await client.get("/api/kiosk/qr")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "KIOSK_SESSION_REVOKED"
    assert kiosk_api.issue_qr_calls == []


async def test_qr_endpoint_rejects_revoked_or_refresh_expired_session(
    client: httpx.AsyncClient,
    kiosk_api: FakeKioskService,
) -> None:
    kiosk_api.reject_access = True

    response = await client.get(
        "/api/kiosk/qr",
        headers={"Cookie": "kiosk_access=signed-access-token"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "KIOSK_SESSION_REVOKED"
    assert kiosk_api.issue_qr_calls == []


async def test_transaction_teardown_failure_replaces_success_response(
    client: httpx.AsyncClient,
) -> None:
    service = FakeKioskService()

    async def failing_service() -> AsyncIterator[FakeKioskService]:
        yield service
        raise ApiError("DATABASE_UNAVAILABLE", "잠시 후 다시 시도해 주세요.", 503)

    app.dependency_overrides[get_kiosk_service] = failing_service
    try:
        response = await client.post(
            "/api/kiosk/sessions",
            json={"password": "church-kiosk-secret"},
            headers={"Origin": settings.allowed_frontend_origins[0]},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert response.headers.get_list("set-cookie") == []


async def test_admin_can_list_and_revoke_kiosk_sessions(
    client: httpx.AsyncClient,
    kiosk_api: FakeKioskService,
) -> None:
    admin = AuthenticatedUser(
        user_id=uuid4(),
        email="admin@example.com",
        provider="google",
        email_verified=True,
    )

    async def current_admin() -> AuthenticatedUser:
        return admin

    app.dependency_overrides[require_admin] = current_admin
    try:
        listed = await client.get("/api/admin/kiosk-sessions")
        revoked = await client.delete(
            f"/api/admin/kiosk-sessions/{kiosk_api.session_id}"
        )
    finally:
        app.dependency_overrides.pop(require_admin, None)

    assert listed.status_code == 200
    assert listed.json()[0]["session_id"] == str(kiosk_api.session_id)
    assert "refresh_token" not in listed.text
    assert revoked.status_code == 204
    assert kiosk_api.admin_revoke_calls == [(kiosk_api.session_id, admin.user_id)]


async def test_kiosk_management_requires_an_administrator(
    client: httpx.AsyncClient,
    kiosk_api: FakeKioskService,
) -> None:
    listed = await client.get("/api/admin/kiosk-sessions")
    revoked = await client.delete(
        f"/api/admin/kiosk-sessions/{kiosk_api.session_id}"
    )

    assert listed.status_code == 401
    assert revoked.status_code == 401
    assert kiosk_api.admin_revoke_calls == []
