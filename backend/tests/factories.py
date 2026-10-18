"""Фабрики тестовых данных.

Тела тестов не заполняют базу вручную (§7 docs/conventions.md). После появления
моделей фабрики работают через них, а не через Core.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Project, Step, Tour, User
from app.schemas.projects import Theme
from app.services.projects import new_public_key


async def make_user(
    session: AsyncSession,
    *,
    email: str | None = None,
    password_hash: str = "argon2-заглушка",
) -> User:
    # Уникальный адрес по умолчанию: тесты не должны мешать друг другу, даже
    # если откат почему-то не сработал.
    user = User(
        email=email or f"user-{uuid.uuid4().hex[:12]}@example.test",
        password_hash=password_hash,
    )
    session.add(user)
    await session.flush()
    return user


async def make_project(
    session: AsyncSession,
    *,
    user: User,
    name: str = "Тестовый проект",
    allowed_origins: list[str] | None = None,
) -> Project:
    project = Project(
        user_id=user.id,
        name=name,
        public_key=new_public_key(),
        allowed_origins=allowed_origins or [],
        theme=Theme().model_dump(),
    )
    session.add(project)
    await session.flush()
    return project


async def make_tour(
    session: AsyncSession,
    *,
    project: Project,
    name: str = "Тестовый тур",
    status: str = "draft",
    url_match_mode: str = "contains",
    url_match_value: str = "/",
) -> Tour:
    tour = Tour(
        project_id=project.id,
        name=name,
        status=status,
        url_match_mode=url_match_mode,
        url_match_value=url_match_value,
        published_at=datetime.now(UTC) if status == "published" else None,
    )
    session.add(tour)
    await session.flush()
    return tour


async def make_step(
    session: AsyncSession,
    *,
    tour: Tour,
    position: int = 0,
    selector: str = "#target",
    title: str = "Заголовок",
    body: str = "Текст подсказки",
) -> Step:
    step = Step(
        tour_id=tour.id,
        position=position,
        selector=selector,
        title=title,
        body=body,
    )
    session.add(step)
    await session.flush()
    return step


async def make_event(
    session: AsyncSession,
    *,
    project: Project,
    tour: Tour | None = None,
    type: str = "tour_started",
    run_id: uuid.UUID | None = None,
    days_ago: int = 0,
    step_position: int | None = None,
) -> Event:
    event = Event(
        event_id=uuid.uuid4(),
        project_id=project.id,
        tour_id=tour.id if tour else None,
        type=type,
        run_id=run_id or uuid.uuid4(),
        visitor_id=uuid.uuid4(),
        step_position=step_position,
        created_at=datetime.now(UTC) - timedelta(days=days_ago),
    )
    session.add(event)
    await session.flush()
    return event
