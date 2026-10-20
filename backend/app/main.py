"""Точка входа API.

Приложение асинхронное (ADR-0010). Ресурсы с пулами создаются один раз
в `lifespan`; `httpx.AsyncClient` появится здесь вместе с первым внешним
вызовом (этап 7) — клиент без потребителей был бы мёртвым кодом.
"""

import logging
import re
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.panel import auth as auth_routes
from app.api.v1.panel import projects as project_routes
from app.api.v1.panel import steps as step_routes
from app.api.v1.panel import tours as tour_routes
from app.api.v1.public import config as public_config_routes
from app.api.v1.public import editor as public_editor_routes
from app.api.v1.public import events as public_event_routes
from app.core.config import get_settings
from app.core.errors import (
    AppError,
    ServiceUnavailableError,
    app_error_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.core.logging import configure_logging, log_event, set_request_id
from app.core.rate_limit import InMemoryRateLimiter
from app.core.widget_manifest import WidgetManifest
from app.db.session import create_engine, create_sessionmaker

REQUEST_ID_HEADER = b"x-request-id"

# Входящий идентификатор уходит обратно в заголовок ответа, поэтому принимается
# только безопасный набор символов и ограниченная длина: иначе клиент мог бы
# протащить в ответ произвольные байты, включая перевод строки.
_SAFE_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")


def _resolve_request_id(scope: dict[str, Any]) -> str:
    incoming = dict(scope["headers"]).get(REQUEST_ID_HEADER, b"")
    candidate = incoming.decode("latin-1", errors="replace")
    if _SAFE_REQUEST_ID.fullmatch(candidate):
        return candidate
    return uuid.uuid4().hex


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)

    engine = create_engine(settings)
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = create_sessionmaker(engine)
    # Счётчики в памяти процесса корректны при одном воркере — это записанное
    # ограничение MVP (§4.5 docs/vision.md), подмена на Redis не меняет вызовы.
    app.state.rate_limiter = InMemoryRateLimiter()
    # Манифест читается лениво и перечитывается по времени модификации: виджет
    # собирается отдельным контейнером, и перезапуск API ради нового хэша ядра
    # означал бы простой (ADR-0009).
    app.state.widget_manifest = WidgetManifest(settings.widget_manifest_path)

    log_event(
        "app.started",
        env=settings.env,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
    )
    try:
        yield
    finally:
        log_event("app.stopping")
        await engine.dispose()


class TransactionMiddleware:
    """Фиксирует транзакцию запроса до того, как ответ уйдёт клиенту.

    Зависимости с `yield` в FastAPI закрываются после отправки ответа. Коммит
    на их выходе означает, что API подтверждает запись раньше, чем она
    зафиксирована: панель получает 204 на удаление, тут же перечитывает список
    и видит удалённый объект. Так это и было найдено — сценарием e2e в T3.2.

    Ответ с кодом 4xx или 5xx означает отказ, и фиксировать там нечего.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[[], Awaitable[Any]],
        send: Callable[[Any], Awaitable[None]],
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Any) -> None:
            if message["type"] == "http.response.start":
                session = scope.get("state", {}).get("session")
                if session is not None:
                    if message["status"] < 400:
                        await session.commit()
                    else:
                        await session.rollback()
            await send(message)

        await self.app(scope, receive, send_wrapper)


class RequestContextMiddleware:
    """Идентификатор запроса и запись о его завершении.

    Чистый ASGI, а не BaseHTTPMiddleware: та оборачивает каждый запрос
    в дополнительную задачу и стоит заметных накладных расходов на горячем пути.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[[], Awaitable[Any]],
        send: Callable[[Any], Awaitable[None]],
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        set_request_id(request_id := _resolve_request_id(scope))

        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Any) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                message["headers"].append((REQUEST_ID_HEADER, request_id.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            log_event(
                "http.request",
                level=logging.WARNING if status_code >= 400 else logging.INFO,
                method=scope["method"],
                path=scope["path"],
                status=status_code,
                duration_ms=round((time.perf_counter() - started) * 1000, 1),
            )


app = FastAPI(title="OnBoard API", lifespan=lifespan)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(TransactionMiddleware)
app.add_exception_handler(AppError, app_error_handler)
# Ошибки самого фреймворка тоже обязаны быть в формате RFC 9457: 404 на
# неизвестный маршрут, 405 и ошибки валидации схем приходят мимо AppError.
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)

app.include_router(auth_routes.router)
app.include_router(auth_routes.me_router)
app.include_router(project_routes.router)
app.include_router(tour_routes.router)
app.include_router(step_routes.router)
app.include_router(public_config_routes.router)
app.include_router(public_event_routes.router)
app.include_router(public_editor_routes.router)


@app.get("/health")
async def health(request: Request) -> Any:
    """Живость процесса и доступность базы.

    Соединение берётся напрямую из движка, а не через зависимость с сессией:
    падение должно быть поймано здесь и превращено в 503, иначе недоступная
    база даст 500 и оркестратор получит невнятный сигнал.
    """
    try:
        async with request.app.state.engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception as exc:
        logging.getLogger("onboard").error("health.db_failed", exc_info=exc)
        raise ServiceUnavailableError("база данных недоступна", db="error") from exc
    return {"status": "ok", "db": "ok"}
