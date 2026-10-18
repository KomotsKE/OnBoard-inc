"""Туры: CRUD, публикация и метрики для списка."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import NotFoundError, ValidationError
from app.models import Event, Project, Step, Tour
from app.schemas.tours import UrlMatch

# Окно метрик в списке туров — скользящее, в UTC (§7.2 docs/vision.md).
METRICS_WINDOW_DAYS = 7


def _with_steps(statement: Select) -> Select:
    # Связи в async SQLAlchemy грузятся явно: ленивой загрузки нет, и это
    # не даёт N+1 возникнуть молча (§12.6 docs/conventions.md).
    return statement.options(selectinload(Tour.steps))


async def create(
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    name: str,
    url_match: UrlMatch,
    show_once: bool,
) -> Tour:
    tour = Tour(
        project_id=project_id,
        name=name,
        url_match_mode=url_match.mode,
        url_match_value=url_match.value,
        show_once=show_once,
    )
    session.add(tour)
    await session.flush()
    await session.refresh(tour, ["steps"])
    return tour


async def get_owned(session: AsyncSession, user_id: uuid.UUID, tour_id: uuid.UUID) -> Tour:
    """Тур владельца — одним запросом с join по проекту.

    Фильтр по `user_id` стоит в самом SQL: отдельная выборка тура, а потом
    проверка проекта означала бы три запроса и соблазн забыть вторую половину
    (ADR-0006).
    """
    tour = await session.scalar(
        _with_steps(
            select(Tour)
            .join(Project, Project.id == Tour.project_id)
            .where(Tour.id == tour_id, Project.user_id == user_id)
        )
    )
    if tour is None:
        raise NotFoundError("тур не найден")
    return tour


async def list_with_metrics(
    session: AsyncSession, project_id: uuid.UUID
) -> list[tuple[Tour, int, int, int]]:
    """Туры проекта с числом шагов и метриками за 7 дней.

    Метрики считаются одним агрегатом по всем турам проекта, а не запросом
    на каждый тур.
    """
    tours = list(
        await session.scalars(
            _with_steps(
                select(Tour).where(Tour.project_id == project_id).order_by(Tour.created_at.desc())
            )
        )
    )
    if not tours:
        return []

    since = datetime.now(UTC) - timedelta(days=METRICS_WINDOW_DAYS)
    rows = await session.execute(
        select(
            Event.tour_id,
            func.count(func.distinct(Event.run_id))
            .filter(Event.type == "tour_started")
            .label("runs"),
            func.count(func.distinct(Event.run_id))
            .filter(Event.type == "tour_completed")
            .label("completed"),
        )
        .where(Event.project_id == project_id, Event.created_at >= since)
        .group_by(Event.tour_id)
    )
    metrics = {row.tour_id: (row.runs, row.completed) for row in rows}

    result = []
    for tour in tours:
        runs, completed = metrics.get(tour.id, (0, 0))
        result.append((tour, len(tour.steps), runs, completed))
    return result


async def update(
    session: AsyncSession,
    tour: Tour,
    *,
    name: str | None = None,
    url_match: UrlMatch | None = None,
    show_once: bool | None = None,
) -> Tour:
    if name is not None:
        tour.name = name
    if url_match is not None:
        tour.url_match_mode = url_match.mode
        tour.url_match_value = url_match.value
    if show_once is not None:
        tour.show_once = show_once
    tour.updated_at = datetime.now(UTC)
    await session.flush()
    return tour


async def publish(session: AsyncSession, tour: Tour) -> Tour:
    count = await session.scalar(
        select(func.count()).select_from(Step).where(Step.tour_id == tour.id)
    )
    if not count:
        # Иначе клиент получит «работающий» тур, который ничего не показывает.
        raise ValidationError("нельзя опубликовать тур без шагов")

    tour.status = "published"
    tour.published_at = datetime.now(UTC)
    tour.updated_at = tour.published_at
    await session.flush()
    return tour


async def unpublish(session: AsyncSession, tour: Tour) -> Tour:
    """Снятие с публикации переводит в черновик; `published_at` сохраняется,
    чтобы было видно, что тур когда-то публиковался."""
    tour.status = "draft"
    tour.updated_at = datetime.now(UTC)
    await session.flush()
    return tour


async def delete(session: AsyncSession, tour: Tour) -> None:
    await session.delete(tour)
    await session.flush()
