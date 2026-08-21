from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.attendance.router import router as attendance_router
from backend.core.config import settings
from backend.core.errors import (
    REQUEST_ID_HEADER,
    ApiError,
    api_error_handler,
    get_request_id,
    http_error_handler,
    request_validation_error_handler,
    unexpected_error_handler,
)
from backend.identity.router import router as identity_router
from backend.kiosk.router import admin_router as kiosk_admin_router
from backend.kiosk.router import router as kiosk_router

app = FastAPI(title="Church Attendance API")
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.add_exception_handler(StarletteHTTPException, http_error_handler)
app.add_exception_handler(Exception, unexpected_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_frontend_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", REQUEST_ID_HEADER],
)
app.include_router(identity_router)
app.include_router(kiosk_router)
app.include_router(kiosk_admin_router)
app.include_router(attendance_router)

if settings.app_env == "test":
    from fixtures.identity_auth import install_identity_auth_fixtures

    install_identity_auth_fixtures(app)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request.state.request_id = str(uuid4())
    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = get_request_id(request)
    return response


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
