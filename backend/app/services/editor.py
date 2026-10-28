"""Режим редактора: выдача сессии для выбора элементов на сайте клиента.

Состояния в базе у сессии нет — всё, что нужно, лежит в подписанном токене
(ADR-0004).
"""

import logging
import uuid
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings
from app.core.errors import NotFoundError, UnauthorizedError, ValidationError
from app.core.logging import log_event
from app.core.security import create_editor_token, read_editor_token
from app.models import Project, Step, Tour
from app.schemas.editor import Mode
from app.services.public_config import origin_allowed

PARAM = "onboard_edit"


def _origin(page_url: str) -> str:
    parts = urlsplit(page_url)
    return f"{parts.scheme}://{parts.netloc}".lower()


def _with_token(page_url: str, token: str) -> str:
    """Токен добавляется к адресу, остальное сохраняется.

    Прежний `onboard_edit` из скопированного адреса убирается: загрузчик читает
    первый параметр и взял бы протухший токен. Query режется по `&` без
    перекодирования, чтобы остальные параметры остались байт в байт.

    Query страницы может быть частью её состояния, а `#/маршрут` у сайтов на
    hash-роутинге — вообще адресом нужной страницы.
    """
    parts = urlsplit(page_url)
    kept = [
        segment
        for segment in parts.query.split("&")
        if segment and segment.split("=", 1)[0] != PARAM
    ]
    query = "&".join([*kept, f"{PARAM}={token}"])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


async def issue_session(
    session: AsyncSession,
    settings: Settings,
    tour: Tour,
    *,
    page_url: str,
    mode: Mode,
) -> tuple[str, int]:
    """Адрес страницы с токеном редактора и срок жизни токена в секундах."""
    project = await session.get(Project, tour.project_id)
    assert project is not None  # тур получен через проект владельца

    if not origin_allowed(project, _origin(page_url)):
        # Тот же список, что пускает виджет на сайт: редактор не может работать
        # там, где виджету запрещено загружаться (§8.1 docs/vision.md).
        raise ValidationError("домена этой страницы нет в списке разрешённых")

    token, expires_in = create_editor_token(settings, str(tour.id), mode)
    return _with_token(page_url, token), expires_in


async def resolve(
    session: AsyncSession, settings: Settings, token: str
) -> tuple[Tour, Project, Mode]:
    """Тур, проект и режим по токену редактора.

    Негодный токен — 401, исчезнувший тур — 404: токен живёт 15 минут и не
    отзывается, поэтому тур вполне может быть удалён в панели у него под
    ногами (ADR-0004).
    """
    scope = read_editor_token(settings, token)
    if scope is None:
        log_event("editor_session.rejected", level=logging.WARNING, reason="expired")
        raise UnauthorizedError("токен редактора недействителен")

    try:
        tour_id = uuid.UUID(scope.tour_id)
    except ValueError:
        log_event("editor_session.rejected", level=logging.WARNING, reason="foreign_tour")
        raise UnauthorizedError("токен редактора недействителен") from None

    tour = await session.scalar(
        select(Tour).options(selectinload(Tour.steps)).where(Tour.id == tour_id)
    )
    if tour is None:
        log_event("editor_session.rejected", level=logging.WARNING, reason="foreign_tour")
        raise NotFoundError("тур не найден")

    project = await session.get(Project, tour.project_id)
    assert project is not None  # тур без проекта невозможен: внешний ключ

    return tour, project, scope.mode


async def step_of(session: AsyncSession, tour: Tour, step_id: uuid.UUID) -> Step:
    """Шаг этого тура. Шаг другого тура неотличим от несуществующего: токен
    даёт права ровно на один тур (ADR-0004, ADR-0006)."""
    step = await session.scalar(select(Step).where(Step.id == step_id, Step.tour_id == tour.id))
    if step is None:
        raise NotFoundError("шаг не найден")
    return step
