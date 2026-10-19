"""Демо-данные для локальной работы (T0.11).

Запуск: `make seed`. Скрипт идемпотентен по адресу демо-пользователя: прежний
пользователь удаляется вместе со всеми своими данными (каскад из §8
docs/data-model.md), после чего набор создаётся заново. Повторный прогон даёт
то же состояние, а не второй комплект проектов.

Ключ первого проекта фиксирован и совпадает со сниппетом стенда
(`testsite/index.html`): иначе после каждого прогона стенд пришлось бы править.
Проверяет это e2e — он ходит на стенд и ждёт успешного ответа конфига.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import create_engine, create_sessionmaker
from app.models import Event, Project, Step, Tour, User
from app.schemas.projects import Theme
from app.services.projects import new_public_key

DEMO_EMAIL = "demo@onboard.local"
# Печатается в конце: пароль должен проходить политику из §5.1 data-model.md
# (минимум 15 символов), иначе демо-пользователь не сможет войти в панель.
DEMO_PASSWORD = "demo-onboard-password"

# Тот же ключ стоит в сниппете стенда.
STAND_PUBLIC_KEY = "pk_00000000000000000000000000000001"
STAND_ORIGIN = "http://localhost:8080"

# Тур привязан к /reports: на этой странице стенда есть и отложенный элемент,
# и тёмная секция, и цель в прокручиваемом блоке. На /settings целей нет —
# это страница «без тура» для e2e.
TOUR_PATH = "/reports"

# Второй тур — ровно про ожидание элемента: его единственный шаг смотрит на
# кнопку, которую стенд вставляет через две секунды. Путь /delayed стенд
# отрисовывает как /reports, но под условие первого тура он не попадает, так
# что какой тур показывается на какой странице — однозначно.
DELAYED_PATH = "/delayed"
# В тексте шага намеренно лежит разметка: владелец сайта пишет его сам, и на
# странице посетителя он обязан остаться текстом (инвариант №6). Это проверяет
# e2e — сквозь базу, API и виджет, а не только юнит-тестом подсказки.
DELAYED_STEP = (
    '[data-testid="export-button"]',
    "Экспорт",
    'Кнопка появляется не сразу: <img src=x onerror="window.__xss=1">',
)

# Третий тур — единственный с show_once: на нём проверяется, что пройденный
# тур не возвращается после перезагрузки. У остальных show_once выключен,
# иначе демо показалось бы один раз и исчезло.
ONCE_PATH = "/once"
ONCE_STEP = ('[data-testid="once-target"]', "Только один раз", "Больше вы меня не увидите.")

STEPS = [
    ('[data-testid="filters-button"]', "Фильтры", "Отчёт настраивается здесь."),
    ('[data-testid="export-button"]', "Экспорт", "Кнопка появляется не сразу — так бывает."),
    ('[data-testid="dark-target"]', "Тёмная секция", "Подсказка обязана остаться читаемой."),
    ('[data-testid="scrolled-target"]', "Цель в прокрутке", "Подсветка следует за элементом."),
]

# Прогоны по исходам: 12 завершений, 4 скипа на втором шаге, 3 обрыва и один
# прогон с ненайденным элементом. 20 прогонов за 7 дней — непустая воронка
# с разными причинами потерь, а не ровный график.
COMPLETED_RUNS = 12
SKIPPED_RUNS = 4
DROPPED_RUNS = 3
MISSING_TARGET_RUNS = 1
TOTAL_RUNS = COMPLETED_RUNS + SKIPPED_RUNS + DROPPED_RUNS + MISSING_TARGET_RUNS


async def _reset(session: AsyncSession) -> None:
    await session.execute(delete(User).where(User.email == DEMO_EMAIL))


async def _create_user(session: AsyncSession) -> User:
    user = User(email=DEMO_EMAIL, password_hash=await hash_password(DEMO_PASSWORD))
    session.add(user)
    await session.flush()
    return user


async def _create_projects(session: AsyncSession, user: User) -> tuple[Project, Project]:
    stand = Project(
        user_id=user.id,
        name="Отчётница (стенд)",
        public_key=STAND_PUBLIC_KEY,
        allowed_origins=[STAND_ORIGIN],
        theme=Theme().model_dump(),
        # Виджет на стенде действительно работает, поэтому проект показывается
        # подключённым сразу: иначе демо начинается с «виджет не найден».
        widget_last_seen_at=datetime.now(UTC),
    )
    # Второй проект пустой намеренно: панели нужен и непустой список туров,
    # и пустое состояние — без него экран проверяется только на демо-данных.
    empty = Project(
        user_id=user.id,
        name="Второй сайт",
        public_key=new_public_key(),
        allowed_origins=["https://example.com"],
        theme=Theme().model_dump(),
    )
    session.add_all([stand, empty])
    await session.flush()
    return stand, empty


async def _create_tour(
    session: AsyncSession,
    project: Project,
    *,
    name: str,
    mode: str,
    value: str,
    steps: list[tuple[str, str, str]],
    show_once: bool = False,
) -> tuple[Tour, list[Step]]:
    now = datetime.now(UTC)
    tour = Tour(
        project_id=project.id,
        name=name,
        status="published",
        url_match_mode=mode,
        url_match_value=value,
        show_once=show_once,
        published_at=now,
        updated_at=now,
    )
    session.add(tour)
    await session.flush()

    created = [
        Step(tour_id=tour.id, position=index, selector=selector, title=title, body=body)
        for index, (selector, title, body) in enumerate(steps)
    ]
    session.add_all(created)
    await session.flush()
    return tour, created


def _run_events(
    project: Project,
    tour: Tour,
    steps: list[Step],
    *,
    viewed: int,
    outcome: str | None,
    at: datetime,
    device: str,
) -> list[Event]:
    """События одного прогона: запуск, просмотренные шаги и исход."""
    run_id = uuid.uuid4()
    visitor_id = uuid.uuid4()

    def event(type_: str, step: Step | None = None, **extra: object) -> Event:
        return Event(
            event_id=uuid.uuid4(),
            project_id=project.id,
            tour_id=tour.id,
            step_id=step.id if step else None,
            step_position=step.position if step else None,
            run_id=run_id,
            visitor_id=visitor_id,
            type=type_,
            url_path=TOUR_PATH,
            device=device,
            created_at=at,
            **extra,
        )

    events = [event("tour_started")]
    events += [event("step_viewed", step) for step in steps[:viewed]]
    if outcome == "tour_completed":
        events.append(event("tour_completed", steps[-1]))
    elif outcome == "tour_skipped":
        events.append(event("tour_skipped", steps[viewed - 1]))
    elif outcome == "step_target_missing":
        events.append(event("step_target_missing", steps[viewed], error_code="target_not_found"))
    return events


def _create_events(project: Project, tour: Tour, steps: list[Step]) -> list[Event]:
    now = datetime.now(UTC)
    plan = (
        [(len(steps), "tour_completed")] * COMPLETED_RUNS
        + [(2, "tour_skipped")] * SKIPPED_RUNS
        + [(1, None)] * DROPPED_RUNS
        + [(1, "step_target_missing")] * MISSING_TARGET_RUNS
    )

    events: list[Event] = []
    for index, (viewed, outcome) in enumerate(plan):
        events += _run_events(
            project,
            tour,
            steps,
            viewed=viewed,
            outcome=outcome,
            # Прогоны размазаны по неделе, иначе окно «за 7 дней» нельзя отличить
            # от «за всё время».
            at=now - timedelta(days=index % 7, hours=index),
            device="mobile" if index % 4 == 0 else "desktop",
        )
    return events


async def seed() -> None:
    engine = create_engine(get_settings())
    factory = create_sessionmaker(engine)
    try:
        async with factory() as session, session.begin():
            await _reset(session)
            user = await _create_user(session)
            stand, empty = await _create_projects(session, user)
            tour, steps = await _create_tour(
                session,
                stand,
                name="Знакомство с отчётами",
                mode="prefix",
                value=TOUR_PATH,
                steps=STEPS,
            )
            delayed, _ = await _create_tour(
                session,
                stand,
                name="Ожидание элемента",
                mode="exact",
                value=DELAYED_PATH,
                steps=[DELAYED_STEP],
            )
            once, _ = await _create_tour(
                session,
                stand,
                name="Показ один раз",
                mode="exact",
                value=ONCE_PATH,
                steps=[ONCE_STEP],
                show_once=True,
            )
            events = _create_events(stand, tour, steps)
            session.add_all(events)
    finally:
        await engine.dispose()

    print(
        "демо-данные готовы:\n"
        f"  вход в панель:   {DEMO_EMAIL} / {DEMO_PASSWORD}\n"
        f"  проекты:         {stand.name} ({STAND_PUBLIC_KEY}), {empty.name}\n"
        f"  туры:            «{tour.name}» ({len(steps)} шага) на {TOUR_PATH},\n"
        f"                   «{delayed.name}» (1 шаг) на {DELAYED_PATH},\n"
        f"                   «{once.name}» (1 шаг, show_once) на {ONCE_PATH}\n"
        f"  событий:         {len(events)} в {TOTAL_RUNS} прогонах"
    )


if __name__ == "__main__":
    asyncio.run(seed())
