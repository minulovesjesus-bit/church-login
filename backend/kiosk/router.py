import ipaddress
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response, status

from backend.core.config import settings
from backend.core.db import get_database_connection
from backend.core.errors import ApiError, safe_error_response
from backend.kiosk.repository import KioskRepository, KioskSessionRecord
from backend.kiosk.schemas import (
    KioskLoginInput,
    KioskSessionView,
    KioskTokens,
    QrChallengeView,
)
from backend.kiosk.security import hash_rate_limit_identity
from backend.kiosk.service import (
    KioskLoginRejected,
    KioskSessionRevoked,
    KioskSessionService,
)

router = APIRouter(prefix="/api/kiosk")
ACCESS_COOKIE = "kiosk_access"
REFRESH_COOKIE = "kiosk_refresh"
ACCESS_COOKIE_MAX_AGE = 15 * 60
REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60


DatabaseConnection = Annotated[
    Any, Depends(get_database_connection, scope="function")
]


async def get_kiosk_repository(
    connection: DatabaseConnection,
) -> KioskRepository:
    return KioskRepository(connection)


KioskRepositoryDependency = Annotated[
    KioskRepository, Depends(get_kiosk_repository, scope="function")
]


async def get_kiosk_service(
    repository: KioskRepositoryDependency,
) -> KioskSessionService:
    if (
        not settings.kiosk_password_hash
        or not settings.kiosk_cookie_secret
        or not settings.qr_signing_secret
    ):
        raise RuntimeError("Kiosk security configuration is required")
    return KioskSessionService(
        repository,
        password_hash=settings.kiosk_password_hash.get_secret_value(),
        cookie_secret=settings.kiosk_cookie_secret.get_secret_value(),
        qr_signing_secret=settings.qr_signing_secret.get_secret_value(),
    )


KioskServiceDependency = Annotated[
    KioskSessionService, Depends(get_kiosk_service, scope="function")
]


def require_trusted_origin(request: Request) -> None:
    if request.headers.get("origin") not in settings.allowed_frontend_origins:
        raise ApiError(
            "ORIGIN_NOT_ALLOWED",
            "허용되지 않은 요청 출처입니다.",
            403,
        )


TrustedOrigin = Annotated[None, Depends(require_trusted_origin)]


async def require_kiosk_session(
    request: Request,
    service: KioskServiceDependency,
) -> KioskSessionRecord:
    access_token = request.cookies.get(ACCESS_COOKIE)
    if not access_token:
        raise KioskSessionRevoked
    return await service.require_access(access_token)


AuthenticatedKioskSession = Annotated[
    KioskSessionRecord, Depends(require_kiosk_session, scope="function")
]
def set_kiosk_cookies(response: Response, tokens: KioskTokens, secure: bool) -> None:
    response.set_cookie(
        ACCESS_COOKIE,
        tokens.access_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=ACCESS_COOKIE_MAX_AGE,
        path="/",
    )
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=REFRESH_COOKIE_MAX_AGE,
        path="/",
    )


def clear_kiosk_cookies(response: Response, secure: bool) -> None:
    response.delete_cookie(
        ACCESS_COOKIE,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/",
    )
    response.delete_cookie(
        REFRESH_COOKIE,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/",
    )


def _cookie_secure() -> bool:
    return settings.kiosk_cookies_secure()


def canonical_client_ip(request: Request) -> str:
    candidate = request.client.host if request.client else "unknown"
    if settings.vercel or settings.vercel_env:
        candidate = request.headers.get("x-vercel-forwarded-for", candidate)
    try:
        return ipaddress.ip_address(candidate.strip()).compressed
    except ValueError:
        return "unknown"


@router.post(
    "/sessions",
    response_model=KioskSessionView,
    status_code=status.HTTP_201_CREATED,
)
async def create_kiosk_session(
    login_input: KioskLoginInput,
    request: Request,
    response: Response,
    _trusted_origin: TrustedOrigin,
    service: KioskServiceDependency,
) -> KioskSessionView | Response:
    client_ip = canonical_client_ip(request)
    cookie_secret = (
        settings.kiosk_cookie_secret.get_secret_value()
        if settings.kiosk_cookie_secret
        else ""
    )
    rate_limit_key_hash = hash_rate_limit_identity(
        client_ip,
        "",
        cookie_secret,
    )
    try:
        tokens = await service.login(login_input.password, rate_limit_key_hash)
    except KioskLoginRejected as error:
        return safe_error_response(
            request,
            code=error.code,
            message=error.message,
            status_code=error.status_code,
        )
    set_kiosk_cookies(response, tokens, _cookie_secure())
    return KioskSessionView.from_tokens(tokens)


@router.post("/sessions/refresh", response_model=KioskSessionView)
async def refresh_kiosk_session(
    request: Request,
    response: Response,
    _trusted_origin: TrustedOrigin,
    service: KioskServiceDependency,
) -> KioskSessionView:
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    if not refresh_token:
        raise KioskSessionRevoked
    tokens = await service.refresh(refresh_token)
    set_kiosk_cookies(response, tokens, _cookie_secure())
    return KioskSessionView.from_tokens(tokens)


@router.delete("/sessions/current", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_current_kiosk_session(
    request: Request,
    response: Response,
    _trusted_origin: TrustedOrigin,
    service: KioskServiceDependency,
) -> None:
    access_token = request.cookies.get(ACCESS_COOKIE)
    if not access_token:
        raise KioskSessionRevoked
    await service.revoke(access_token)
    clear_kiosk_cookies(response, _cookie_secure())


@router.get("/qr", response_model=QrChallengeView)
async def get_kiosk_qr(
    response: Response,
    session: AuthenticatedKioskSession,
    service: KioskServiceDependency,
) -> QrChallengeView:
    response.headers["Cache-Control"] = "no-store"
    issued = service.issue_qr_challenge(session.id)
    return QrChallengeView.from_issued(issued)
