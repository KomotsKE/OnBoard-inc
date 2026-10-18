"""Проекты владельца сайта.

Сервис не знает про HTTP и не коммитит: транзакцией управляет обработчик.
Доступ к проекту всегда идёт через `get_owned` — фильтр по владельцу стоит
в самом запросе, а не проверкой после выборки (ADR-0006).
"""

import secrets
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import NotFoundError, ValidationError
from app.models import Project
from app.schemas.projects import PROJECTS_PER_USER, Theme


def new_public_key() -> str:
    """Формат проверяется ограничением `projects_key_fmt` в базе."""
    return "pk_" + secrets.token_hex(16)


async def create(session: AsyncSession, user_id: uuid.UUID, name: str) -> Project:
    count = await session.scalar(
        select(func.count()).select_from(Project).where(Project.user_id == user_id)
    )
    if (count or 0) >= PROJECTS_PER_USER:
        raise ValidationError(f"больше {PROJECTS_PER_USER} проектов на аккаунт нельзя")

    project = Project(
        user_id=user_id,
        name=name,
        public_key=new_public_key(),
        allowed_origins=[],
        # Тема пишется целиком, а не остаётся пустым объектом: публичный конфиг
        # должен отдавать виджету полный набор значений без доклейки на чтении.
        theme=Theme().model_dump(),
    )
    session.add(project)
    await session.flush()
    return project


async def list_for_user(session: AsyncSession, user_id: uuid.UUID) -> list[Project]:
    result = await session.scalars(
        select(Project).where(Project.user_id == user_id).order_by(Project.created_at.desc())
    )
    return list(result)


async def get_owned(session: AsyncSession, user_id: uuid.UUID, project_id: uuid.UUID) -> Project:
    """Чужой или несуществующий проект — одинаковый 404 (ADR-0006)."""
    project = await session.scalar(
        select(Project).where(Project.id == project_id, Project.user_id == user_id)
    )
    if project is None:
        raise NotFoundError("проект не найден")
    return project


async def update(
    session: AsyncSession,
    project: Project,
    *,
    name: str | None = None,
    allowed_origins: list[str] | None = None,
    theme: Theme | None = None,
) -> Project:
    if name is not None:
        project.name = name
    if allowed_origins is not None:
        project.allowed_origins = allowed_origins
    if theme is not None:
        project.theme = theme.model_dump()
    await session.flush()
    return project


async def delete(session: AsyncSession, project: Project) -> None:
    """Каскад уносит туры, шаги и все события проекта (§8 docs/data-model.md)."""
    await session.delete(project)
    await session.flush()


def snippet_for(settings: Settings, project: Project) -> str:
    """Готовый тег для вставки на сайт клиента.

    Адрес берётся из настроек: при переезде на сервер меняется переменная
    окружения, а не код и не выданные клиентам сниппеты.
    """
    # Pydantic нормализует адрес, добавляя завершающий слэш: без срезания
    # в сниппете у клиента оказался бы data-api с хвостом, а дальше двойные
    # слэши в запросах.
    api = str(settings.public_api_url).rstrip("/")
    widget = str(settings.widget_base_url).rstrip("/")
    return (
        f'<script src="{widget}/loader.js"\n'
        f'        data-key="{project.public_key}"\n'
        f'        data-api="{api}"\n'
        f"        async></script>"
    )
