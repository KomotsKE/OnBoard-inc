"""Воронка тура: один SQL с агрегатами.

Цикл по событиям в Python запрещён (§4.5 docs/vision.md): на сотнях тысяч
строк это единственное место, которое гарантированно станет узким. Здесь
перебираются только строки агрегата — их столько же, сколько шагов в туре.

Граница окна считается один раз и используется и для тоталов, и для воронки:
иначе суммы не сойдутся между блоками одного экрана (§7.2 docs/vision.md).
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Tour
from app.schemas.analytics import (
    RANGE_DAYS,
    FunnelStep,
    Issue,
    Range,
    Totals,
    TourAnalytics,
)


@dataclass(frozen=True)
class Row:
    """Строка агрегата: сколько прогонов и сколько событий в каждой группе."""

    type: str
    step_position: int | None
    error_code: str | None
    runs: int
    events: int


async def _aggregate(session: AsyncSession, tour: Tour, since: datetime) -> list[Row]:
    result = await session.execute(
        select(
            Event.type,
            Event.step_position,
            Event.error_code,
            func.count(func.distinct(Event.run_id)).label("runs"),
            func.count().label("events"),
        )
        .where(
            Event.tour_id == tour.id,
            # Фильтр по проекту, а не только по туру: событие с чужим tour_id
            # в свою воронку попасть не должно (T4.1).
            Event.project_id == tour.project_id,
            Event.created_at >= since,
        )
        .group_by(Event.type, Event.step_position, Event.error_code)
    )
    return [
        Row(
            type=row.type,
            step_position=row.step_position,
            error_code=row.error_code,
            runs=row.runs,
            events=row.events,
        )
        for row in result
    ]


def _runs_of(rows: list[Row], event_type: str) -> int:
    return sum(row.runs for row in rows if row.type == event_type)


def _share(part: int, whole: int) -> float:
    return round(part / whole, 4) if whole else 0.0


def _funnel(rows: list[Row], tour: Tour, runs: int, completed: int) -> list[FunnelStep]:
    viewed = {
        row.step_position: row.runs
        for row in rows
        if row.type == "step_viewed" and row.step_position is not None
    }

    steps: list[FunnelStep] = []
    for position, step in enumerate(tour.steps):
        reached = viewed.get(position, 0)
        # Потеря считается относительно следующего шага, а у последнего —
        # относительно завершивших тур: иначе последний шаг всегда выглядел бы
        # идеальным.
        following = viewed.get(position + 1, 0) if position + 1 < len(tour.steps) else completed
        steps.append(
            FunnelStep(
                step_position=position,
                step_id=str(step.id),
                title=step.title or step.selector,
                selector=step.selector,
                runs=reached,
                rate=_share(reached, runs),
                drop_off=round(1 - following / reached, 4) if reached else 0.0,
            )
        )
    return steps


def _issues(rows: list[Row], tour: Tour) -> list[Issue]:
    selectors = {position: step.selector for position, step in enumerate(tour.steps)}
    issues = [
        Issue(
            type="step_target_missing",
            step_position=row.step_position,
            selector=selectors.get(row.step_position) if row.step_position is not None else None,
            count=row.events,
        )
        for row in rows
        if row.type == "step_target_missing"
    ]
    issues += [
        Issue(type="widget_error", error_code=row.error_code, count=row.events)
        for row in rows
        if row.type == "widget_error"
    ]
    # Самое частое — первым: это список для разбора, а не хронология.
    return sorted(issues, key=lambda issue: issue.count, reverse=True)


async def tour_analytics(session: AsyncSession, tour: Tour, window: Range) -> TourAnalytics:
    since = datetime.now(UTC) - timedelta(days=RANGE_DAYS[window])
    rows = await _aggregate(session, tour, since)

    runs = _runs_of(rows, "tour_started")
    completed = _runs_of(rows, "tour_completed")
    skipped = _runs_of(rows, "tour_skipped")

    funnel = _funnel(rows, tour, runs, completed)
    # Худший шаг ищется среди тех, до которых вообще дошли: шаг с нулём
    # прогонов не «проблемный», он просто недостижим.
    reached = [step for step in funnel if step.runs > 0]
    problem = max(reached, key=lambda step: step.drop_off, default=None)

    return TourAnalytics(
        range=window,
        since=since.isoformat(),
        totals=Totals(
            runs=runs,
            completed=completed,
            skipped=skipped,
            # Разность, а не отдельное событие: «закрыл вкладку» виджет
            # сообщить не может по определению.
            dropped=max(runs - completed - skipped, 0),
            completion_rate=_share(completed, runs),
            skip_rate=_share(skipped, runs),
        ),
        funnel=funnel,
        problem_step=problem.step_position if problem and problem.drop_off > 0 else None,
        issues=_issues(rows, tour),
    )
