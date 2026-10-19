"""Приём событий от виджета.

Отвечает `204` всегда, когда ключ верный, домен разрешён и лимит не превышен:
виджету нечего чинить повтором, а повторы по ошибкам схемы превратились бы
в бесконечный шторм с чужих страниц (§7 docs/vision.md).
"""

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import ValidationError as SchemaError

from app.core.deps import PublicSession
from app.core.errors import ForbiddenOriginError, RateLimitedError, ValidationError
from app.core.logging import log_event
from app.core.rate_limit import PUBLIC_EVENTS, RateLimiter
from app.schemas.events import EventBatch
from app.services import events as service
from app.services import public_config as projects

router = APIRouter(prefix="/v1/public", tags=["public"])


def _limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


Limiter = Annotated[RateLimiter, Depends(_limiter)]


async def _read_batch(request: Request) -> EventBatch:
    """Разбирает тело запроса независимо от Content-Type.

    `navigator.sendBeacon` отправляет строку с `text/plain`, и это не наш
    выбор, а поведение браузера. Простой запрос без preflight — ровно то,
    что нужно на выгрузке при закрытии вкладки (T4.2), поэтому тело читается
    и разбирается вручную.
    """
    try:
        payload = json.loads(await request.body())
    except (ValueError, UnicodeDecodeError) as error:
        raise ValidationError("тело запроса не разбирается как JSON") from error

    try:
        return EventBatch.model_validate(payload)
    except SchemaError as error:
        # Конверт батча — другое дело: без ключа принимать нечего.
        raise ValidationError("некорректный батч событий") from error


@router.post("/events", status_code=status.HTTP_204_NO_CONTENT)
async def ingest(request: Request, session: PublicSession, limiter: Limiter) -> Response:
    batch = await _read_batch(request)

    client_ip = request.client.host if request.client else "unknown"
    limit, window = PUBLIC_EVENTS
    decision = limiter.allow(f"events:{batch.key}:{client_ip}", limit, window)
    if not decision.allowed:
        # Имя политики, а не ключ бакета: в ключе есть IP (инвариант №7).
        log_event("rate_limit.exceeded", level=logging.WARNING, limit="public_events")
        raise RateLimitedError(decision.retry_after_s)

    project = await projects.get_project(session, batch.key)

    origin = request.headers.get("origin", "")
    if not projects.origin_allowed(project, origin):
        log_event(
            "events.batch_rejected",
            level=logging.WARNING,
            project_id=str(project.id),
            reason="forbidden_origin",
        )
        raise ForbiddenOriginError("origin не разрешён для проекта")

    events, dropped = service.parse(batch.events)
    stored = await service.store(session, project.id, events)

    log_event(
        "events.batch_accepted",
        project_id=str(project.id),
        received=len(batch.events),
        stored=stored,
        duplicates=len(events) - stored,
        dropped=dropped,
    )
    # Тот же эхо-заголовок, что и у конфига: без него браузер не считает
    # запрос успешным и виджет начнёт повторять уже доставленное.
    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
        headers={"Access-Control-Allow-Origin": origin, "Vary": "Origin"},
    )
