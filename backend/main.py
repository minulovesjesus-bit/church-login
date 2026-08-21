from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Request, Response

from backend.core.auth import require_google_user
from backend.core.errors import (
    REQUEST_ID_HEADER,
    ApiError,
    api_error_handler,
    get_request_id,
)
from backend.identity.models import AuthenticatedUser
from backend.identity.router import router as identity_router

app = FastAPI(title="Church Attendance API")
app.add_exception_handler(ApiError, api_error_handler)
app.include_router(identity_router)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request.state.request_id = str(uuid4())
    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = get_request_id(request)
    return response


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/teacher-applications", status_code=204)
async def authorize_teacher_application(
    _user: Annotated[AuthenticatedUser, Depends(require_google_user)],
) -> Response:
    return Response(status_code=204)
