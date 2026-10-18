"""Доменные исключения и ответы по RFC 9457 (§4.5 docs/vision.md).

Сервисы поднимают эти исключения и ничего не знают про HTTP; перевод в ответ
живёт в одном обработчике, который регистрируется в main.py.
"""

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_MEDIA_TYPE = "application/problem+json"


class AppError(Exception):
    """База для доменных ошибок. `type` — машиночитаемый идентификатор,
    по `detail` клиент логику не ветвит (§4 docs/conventions.md)."""

    status: int = 500
    type: str = "/errors/internal"
    title: str = "Внутренняя ошибка"

    def __init__(self, detail: str | None = None, **extra: object) -> None:
        super().__init__(detail or self.title)
        self.detail = detail
        self.extra = extra


class NotFoundError(AppError):
    status = 404
    type = "/errors/not-found"
    title = "Объект не найден"


class UnauthorizedError(AppError):
    status = 401
    type = "/errors/unauthorized"
    title = "Требуется аутентификация"


class ConflictError(AppError):
    status = 409
    type = "/errors/conflict"
    title = "Конфликт"


class ValidationError(AppError):
    status = 422
    type = "/errors/validation"
    title = "Некорректные данные"


class ForbiddenOriginError(AppError):
    status = 403
    type = "/errors/forbidden-origin"
    title = "Origin не разрешён для проекта"


class RateLimitedError(AppError):
    status = 429
    type = "/errors/rate-limited"
    title = "Слишком много запросов"

    def __init__(self, retry_after_s: int, detail: str | None = None) -> None:
        super().__init__(detail)
        self.retry_after_s = retry_after_s


class ServiceUnavailableError(AppError):
    status = 503
    type = "/errors/unavailable"
    title = "Сервис временно недоступен"


def problem_response(error: AppError) -> JSONResponse:
    body: dict[str, object] = {
        "type": error.type,
        "title": error.title,
        "status": error.status,
    }
    if error.detail:
        body["detail"] = error.detail
    body.update(error.extra)

    headers = {}
    if isinstance(error, RateLimitedError):
        headers["Retry-After"] = str(error.retry_after_s)

    return JSONResponse(
        body,
        status_code=error.status,
        media_type=PROBLEM_MEDIA_TYPE,
        headers=headers or None,
    )


async def app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return problem_response(exc)


async def http_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """404, 405 и прочие ответы самого фреймворка — в том же формате."""
    assert isinstance(exc, StarletteHTTPException)
    titles = {
        401: "Требуется аутентификация",
        403: "Доступ запрещён",
        404: "Объект не найден",
        405: "Метод не поддерживается",
    }
    error = AppError(exc.detail if isinstance(exc.detail, str) else None)
    error.status = exc.status_code
    error.type = f"/errors/http-{exc.status_code}"
    error.title = titles.get(exc.status_code, "Ошибка запроса")
    return problem_response(error)


async def validation_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """Ошибки схем Pydantic. Значения полей в ответ не попадают: в теле запроса
    бывают пароли, и они не должны вернуться клиенту и попасть в логи."""
    assert isinstance(exc, RequestValidationError)
    fields = sorted(
        {".".join(str(part) for part in err["loc"][1:]) or "body" for err in exc.errors()}
    )
    error = ValidationError("проверьте поля: " + ", ".join(fields), fields=fields)
    return problem_response(error)
