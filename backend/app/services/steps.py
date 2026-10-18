"""Шаги тура: создание, правка, удаление и перестановка.

Перестановка выполняется одним `UPDATE ... CASE`. Это возможно потому, что
уникальность `(tour_id, position)` объявлена `DEFERRABLE`: проверка переносится
на конец оператора, и промежуточное состояние с одинаковыми позициями
допустимо. С обычным `UNIQUE` тот же запрос падал бы посреди выполнения —
проверено на PostgreSQL 16.15 (§11 docs/data-model.md).
"""

import uuid

from sqlalchemy import case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationError
from app.models import Project, Step, Tour
from app.schemas.tours import STEPS_PER_TOUR, Placement


async def get_owned(session: AsyncSession, user_id: uuid.UUID, step_id: uuid.UUID) -> Step:
    """Шаг владельца — одним запросом через тур и проект."""
    step = await session.scalar(
        select(Step)
        .join(Tour, Tour.id == Step.tour_id)
        .join(Project, Project.id == Tour.project_id)
        .where(Step.id == step_id, Project.user_id == user_id)
    )
    if step is None:
        raise NotFoundError("шаг не найден")
    return step


async def create(
    session: AsyncSession,
    tour: Tour,
    *,
    selector: str,
    body: str,
    title: str,
    placement: Placement,
) -> Step:
    count = await session.scalar(
        select(func.count()).select_from(Step).where(Step.tour_id == tour.id)
    )
    if (count or 0) >= STEPS_PER_TOUR:
        raise ValidationError(f"больше {STEPS_PER_TOUR} шагов в туре нельзя")

    step = Step(
        tour_id=tour.id,
        # Новый шаг встаёт в конец: вставку в середину делает перестановка.
        position=count or 0,
        selector=selector,
        body=body,
        title=title,
        placement=placement,
    )
    session.add(step)
    await session.flush()
    return step


async def update_step(
    session: AsyncSession,
    step: Step,
    *,
    selector: str | None = None,
    body: str | None = None,
    title: str | None = None,
    placement: Placement | None = None,
) -> Step:
    if selector is not None:
        step.selector = selector
    if body is not None:
        step.body = body
    if title is not None:
        step.title = title
    if placement is not None:
        step.placement = placement
    await session.flush()
    return step


async def reorder(session: AsyncSession, tour: Tour, step_ids: list[uuid.UUID]) -> list[Step]:
    existing = set(await session.scalars(select(Step.id).where(Step.tour_id == tour.id)))
    if set(step_ids) != existing or len(step_ids) != len(set(step_ids)):
        raise ValidationError("порядок должен содержать все шаги тура ровно по одному разу")

    await session.execute(
        update(Step)
        .where(Step.tour_id == tour.id)
        .values(
            position=case(
                {step_id: index for index, step_id in enumerate(step_ids)},
                value=Step.id,
            )
        )
    )
    await session.flush()
    return await ordered_steps(session, tour.id)


async def delete(session: AsyncSession, step: Step) -> tuple[Tour, int]:
    """Удаляет шаг, сжимает позиции и, если шагов не осталось, снимает тур
    с публикации: опубликованный тур без шагов хуже, чем запрет удаления."""
    tour = await session.get(Tour, step.tour_id)
    assert tour is not None  # шаг получен через тур, он существует

    await session.delete(step)
    await session.flush()

    remaining = await ordered_steps(session, tour.id)
    if remaining:
        await session.execute(
            update(Step)
            .where(Step.tour_id == tour.id)
            .values(
                position=case(
                    {item.id: index for index, item in enumerate(remaining)},
                    value=Step.id,
                )
            )
        )
    elif tour.status == "published":
        tour.status = "draft"

    await session.flush()
    return tour, len(remaining)


async def ordered_steps(session: AsyncSession, tour_id: uuid.UUID) -> list[Step]:
    return list(
        await session.scalars(select(Step).where(Step.tour_id == tour_id).order_by(Step.position))
    )
