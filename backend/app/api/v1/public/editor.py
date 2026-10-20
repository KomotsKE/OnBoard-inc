"""Публичный контур редактора: выбор элементов идёт с сайта клиента.

Авторизация здесь не по публичному ключу, а по токену сессии редактора: он
подписан, живёт 15 минут и даёт права ровно на один тур (ADR-0004). Origin
проверяется тем же списком `allowed_origins`, что пускает виджет: редактор не
может работать там, где виджету запрещено загружаться.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status

from app.core.deps import PublicSession, SettingsDep
from app.core.errors import ForbiddenError, ForbiddenOriginError, ServiceUnavailableError
from app.core.logging import log_event
from app.core.rate_limit import PUBLIC_EDITOR, RateLimiter, check
from app.core.widget_manifest import WidgetManifest
from app.models import Project, Tour
from app.schemas.editor import (
    EditorState,
    EditorStepCreate,
    EditorStepUpdate,
    EditorTour,
    Mode,
)
from app.schemas.projects import Theme
from app.schemas.tours import StepRead
from app.services import editor as service
from app.services import steps as steps_service
from app.services.public_config import origin_allowed

router = APIRouter(prefix="/v1/public/editor", tags=["public"])

# Preflight кэшируется, чтобы на каждый шаг не приходилось по два запроса.
PREFLIGHT_MAX_AGE = "600"
ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS"


def _limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


def _manifest(request: Request) -> WidgetManifest:
    return request.app.state.widget_manifest


Limiter = Annotated[RateLimiter, Depends(_limiter)]
Manifest = Annotated[WidgetManifest, Depends(_manifest)]


def _read(step) -> StepRead:
    return StepRead(
        id=str(step.id),
        position=step.position,
        selector=step.selector,
        title=step.title,
        body=step.body,
        placement=step.placement,
    )


def _allow_origin(response: Response, origin: str) -> None:
    """Эхо проверенного домена, а не `*`: ответ зависит от домена."""
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Vary"] = "Origin"


async def _authorise(
    request: Request,
    response: Response,
    session: PublicSession,
    settings: SettingsDep,
    limiter: RateLimiter,
    token: str,
    *,
    writes: bool,
) -> tuple[Tour, Project, Mode]:
    """Общий вход всех маршрутов редактора: лимит, токен, домен, режим."""
    tour, project, mode = await service.resolve(session, settings, token)
    check(limiter, f"editor:{tour.id}", PUBLIC_EDITOR, name="public_editor")

    origin = request.headers.get("origin", "")
    if not origin_allowed(project, origin):
        raise ForbiddenOriginError("origin не разрешён для проекта")

    if writes and mode != "edit":
        # Превью проходит тур глазами посетителя и ничего не меняет (T5.6).
        raise ForbiddenError("токен предпросмотра не меняет шаги")

    _allow_origin(response, origin)
    return tour, project, mode


@router.options("/{rest:path}", status_code=status.HTTP_204_NO_CONTENT)
async def preflight(request: Request, rest: str) -> Response:
    """Предварительный запрос браузера.

    Токена в нём нет по определению, поэтому проверять здесь нечего: доступ
    решается на самом запросе, а preflight только сообщает браузеру, что метод
    и заголовки допустимы.
    """
    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
        headers={
            "Access-Control-Allow-Origin": request.headers.get("origin", "*"),
            "Access-Control-Allow-Methods": ALLOWED_METHODS,
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": PREFLIGHT_MAX_AGE,
            "Vary": "Origin",
        },
    )


@router.get("/session", response_model=EditorState)
async def read_session(
    request: Request,
    response: Response,
    session: PublicSession,
    settings: SettingsDep,
    limiter: Limiter,
    manifest: Manifest,
    token: Annotated[str, Query(min_length=1, max_length=2000)],
) -> EditorState:
    tour, project, mode = await _authorise(
        request, response, session, settings, limiter, token, writes=False
    )

    editor_file = manifest.editor_file()
    if editor_file is None:
        # Как и у конфига: отсутствие манифеста — отказ развёртки, и он должен
        # быть виден в логах, а не выглядеть как «редактор не работает».
        raise ServiceUnavailableError("бандл редактора недоступен")

    return EditorState(
        mode=mode,
        editor_url=f"{str(settings.widget_base_url).rstrip('/')}/{editor_file}",
        tour=EditorTour(id=str(tour.id), name=tour.name),
        steps=[_read(step) for step in tour.steps],
        theme=Theme(**project.theme),
    )


@router.post("/steps", response_model=StepRead, status_code=status.HTTP_201_CREATED)
async def create_step(
    body: EditorStepCreate,
    request: Request,
    response: Response,
    session: PublicSession,
    settings: SettingsDep,
    limiter: Limiter,
) -> StepRead:
    tour, _, _ = await _authorise(
        request, response, session, settings, limiter, body.token, writes=True
    )
    step = await steps_service.create(
        session,
        tour,
        selector=body.step.selector,
        body=body.step.body,
        title=body.step.title,
        placement=body.step.placement,
    )
    log_event("step.created", tour_id=str(tour.id), step_id=str(step.id), source="editor")
    return _read(step)


@router.patch("/steps/{step_id}", response_model=StepRead)
async def update_step(
    step_id: uuid.UUID,
    body: EditorStepUpdate,
    request: Request,
    response: Response,
    session: PublicSession,
    settings: SettingsDep,
    limiter: Limiter,
) -> StepRead:
    tour, _, _ = await _authorise(
        request, response, session, settings, limiter, body.token, writes=True
    )
    step = await service.step_of(session, tour, step_id)
    updated = await steps_service.update_step(
        session,
        step,
        selector=body.step.selector,
        body=body.step.body,
        title=body.step.title,
        placement=body.step.placement,
    )
    log_event("step.updated", tour_id=str(tour.id), step_id=str(step.id), source="editor")
    return _read(updated)


@router.delete("/steps/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_step(
    step_id: uuid.UUID,
    request: Request,
    response: Response,
    session: PublicSession,
    settings: SettingsDep,
    limiter: Limiter,
    token: Annotated[str, Query(min_length=1, max_length=2000)],
) -> Response:
    tour, _, _ = await _authorise(request, response, session, settings, limiter, token, writes=True)
    step = await service.step_of(session, tour, step_id)
    _, remaining = await steps_service.delete(session, step)
    log_event(
        "step.deleted",
        tour_id=str(tour.id),
        step_id=str(step_id),
        steps_left=remaining,
        source="editor",
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers=dict(response.headers))
