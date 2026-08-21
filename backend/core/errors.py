from uuid import uuid4

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

REQUEST_ID_HEADER = "X-Request-ID"


class ApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.message = message
        self.status_code = status_code


def get_request_id(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    if isinstance(request_id, str):
        return request_id

    request_id = str(uuid4())
    request.state.request_id = request_id
    return request_id


async def api_error_handler(request: Request, error: ApiError) -> JSONResponse:
    return safe_error_response(
        request,
        code=error.code,
        message=error.message,
        status_code=error.status_code,
    )


def safe_error_response(
    request: Request,
    *,
    code: str,
    message: str,
    status_code: int,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = get_request_id(request)
    response_headers = dict(headers or {})
    response_headers[REQUEST_ID_HEADER] = request_id
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": request_id,
            }
        },
        headers=response_headers,
    )


async def request_validation_error_handler(
    request: Request, _error: RequestValidationError
) -> JSONResponse:
    return safe_error_response(
        request,
        code="VALIDATION_ERROR",
        message="입력값을 확인해 주세요.",
        status_code=422,
    )


async def http_error_handler(
    request: Request, error: StarletteHTTPException
) -> JSONResponse:
    known_errors = {
        404: ("NOT_FOUND", "요청한 경로를 찾을 수 없습니다."),
        405: ("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다."),
    }
    code, message = known_errors.get(
        error.status_code,
        ("HTTP_ERROR", "요청을 처리할 수 없습니다."),
    )
    return safe_error_response(
        request,
        code=code,
        message=message,
        status_code=error.status_code,
        headers=error.headers,
    )


async def unexpected_error_handler(
    request: Request, _error: Exception
) -> JSONResponse:
    return safe_error_response(
        request,
        code="INTERNAL_ERROR",
        message="잠시 후 다시 시도해 주세요.",
        status_code=500,
    )
