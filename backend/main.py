from uuid import uuid4

from fastapi import FastAPI, Request

from backend.core.errors import (
    REQUEST_ID_HEADER,
    ApiError,
    api_error_handler,
    get_request_id,
)
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
