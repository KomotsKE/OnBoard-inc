"""Конфиг виджета: единственный запрос, который делает загрузчик на странице.

Авторизация здесь не по токену, а по паре «публичный ключ + Origin»: ключ виден
в исходниках страницы клиента, поэтому домен проверяется обязательно и по
принципу fail closed (§8.1 docs/vision.md).
"""

import hashlib
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response

from app.core.deps import PublicSession, SettingsDep
from app.core.errors import (
    ForbiddenOriginError,
    RateLimitedError,
    ServiceUnavailableError,
)
from app.core.logging import log_event
from app.core.rate_limit import PUBLIC_CONFIG, RateLimiter
from app.core.widget_manifest import WidgetManifest
from app.models import Tour
from app.schemas.projects import Theme
from app.schemas.public import (
    PUBLIC_KEY_PATTERN,
    URL_MAX,
    PublicProject,
    PublicTour,
    WidgetConfig,
)
from app.schemas.tours import StepRead
from app.services import public_config as service

router = APIRouter(prefix="/v1/public", tags=["public"])

# Минута кэша: тур, опубликованный в панели, доезжает до посетителей почти
# сразу, а шквал запросов с одной страницы не доходит до API (ADR-0009).
CACHE_CONTROL = "public, max-age=60"


def _limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


def _manifest(request: Request) -> WidgetManifest:
    return request.app.state.widget_manifest


Limiter = Annotated[RateLimiter, Depends(_limiter)]
Manifest = Annotated[WidgetManifest, Depends(_manifest)]


def _public_tour(tour: Tour) -> PublicTour:
    return PublicTour(
        id=str(tour.id),
        name=tour.name,
        show_once=tour.show_once,
        steps=[
            StepRead(
                id=str(step.id),
                position=step.position,
                selector=step.selector,
                title=step.title,
                body=step.body,
                placement=step.placement,
            )
            for step in tour.steps
        ],
    )


def _headers(origin: str, etag: str) -> dict[str, str]:
    """Заголовки кэша и CORS.

    В `Access-Control-Allow-Origin` уходит именно проверенный домен, а не `*`:
    ответ зависит от домена, и `Vary` сообщает об этом промежуточным кэшам.
    На ответах с ошибкой этих заголовков нет намеренно — виджет одинаково
    молчит при любом отказе и тела ошибки не читает.
    """
    return {
        "ETag": etag,
        "Cache-Control": CACHE_CONTROL,
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin",
    }


@router.get("/config", response_model=WidgetConfig)
async def widget_config(
    request: Request,
    key: Annotated[str, Query(pattern=PUBLIC_KEY_PATTERN)],
    url: Annotated[str, Query(min_length=1, max_length=URL_MAX)],
    session: PublicSession,
    settings: SettingsDep,
    limiter: Limiter,
    manifest: Manifest,
) -> Response:
    client_ip = request.client.host if request.client else "unknown"
    limit, window = PUBLIC_CONFIG
    decision = limiter.allow(f"config:{key}:{client_ip}", limit, window)
    if not decision.allowed:
        # Имя политики, а не ключ бакета: в ключе есть IP, а его в логах нет
        # никогда (инвариант №7).
        log_event("rate_limit.exceeded", level=logging.WARNING, limit="public_config")
        raise RateLimitedError(decision.retry_after_s)

    project = await service.get_project(session, key)

    origin = request.headers.get("origin", "")
    if not service.origin_allowed(project, origin):
        log_event(
            "widget.config.forbidden_origin",
            level=logging.WARNING,
            project_id=str(project.id),
        )
        raise ForbiddenOriginError("origin не разрешён для проекта")

    core_file = manifest.core_file()
    if core_file is None:
        # Манифеста нет — виджет не собран или не доставлен. Это отказ развёртки,
        # а не ошибка клиента: сайт клиента не ломаем, но молчать в логах нельзя.
        logging.getLogger("onboard").error("widget.manifest_missing")
        raise ServiceUnavailableError("бандл виджета недоступен")

    tour = await service.find_tour(session, project.id, service.normalise_url(url))
    if await service.touch_widget_seen(session, project):
        log_event("widget.first_seen", project_id=str(project.id))

    config = WidgetConfig(
        core_url=f"{str(settings.widget_base_url).rstrip('/')}/{core_file}",
        project=PublicProject(theme=Theme(**project.theme)),
        tour=_public_tour(tour) if tour else None,
    )
    body = config.model_dump_json()
    etag = f'"{hashlib.sha256(body.encode("utf-8")).hexdigest()[:32]}"'

    headers = _headers(origin, etag)
    if request.headers.get("if-none-match") == etag:
        # Экономия трафика, а не запросов к базе: отметку «виджет жив» и отбор
        # тура всё равно приходится сделать, чтобы узнать текущий ETag.
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)
