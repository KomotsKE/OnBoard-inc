"""Зависимости FastAPI. Изоляция арендаторов (`get_owned_*`) добавляется
вместе с первым приватным ресурсом в T1.2, а не дописывается потом.
"""

import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import UnauthorizedError
from app.core.security import read_access_token
from app.db.session import open_session
from app.models import Project, Tour, User
from app.services import projects as projects_service
from app.services import tours as tours_service


def settings_dep() -> Settings:
    return get_settings()


async def public_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Сессия для публичных маршрутов виджета: таймаут строже."""
    settings = request.app.state.settings
    async with open_session(
        request.app.state.sessionmaker,
        settings.db_statement_timeout_public_ms,
    ) as session:
        yield session


async def panel_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Сессия для маршрутов панели."""
    settings = request.app.state.settings
    async with open_session(
        request.app.state.sessionmaker,
        settings.db_statement_timeout_panel_ms,
    ) as session:
        yield session


PublicSession = Annotated[AsyncSession, Depends(public_session)]
PanelSession = Annotated[AsyncSession, Depends(panel_session)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]


async def current_user(request: Request, session: PanelSession) -> User:
    """Владелец из access-токена.

    Токен приходит в заголовке Authorization: access-токен живёт в памяти
    панели и в cookie не хранится (ADR-0008).
    """
    header = request.headers.get("Authorization", "")
    scheme, _, raw = header.partition(" ")
    if scheme.lower() != "bearer" or not raw:
        raise UnauthorizedError("нет access-токена")

    subject = read_access_token(request.app.state.settings, raw.strip())
    if subject is None:
        raise UnauthorizedError("access-токен недействителен")

    try:
        user_id = uuid.UUID(subject)
    except ValueError as exc:
        raise UnauthorizedError("access-токен недействителен") from exc

    user = await session.get(User, user_id)
    if user is None:
        raise UnauthorizedError("access-токен недействителен")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def owned_project(
    project_id: uuid.UUID,
    user: CurrentUser,
    session: PanelSession,
) -> Project:
    """Проект владельца из пути запроса.

    Фильтр по `user_id` стоит в самом запросе к базе: проверка после выборки
    забывается в новом обработчике, и это сразу утечка (ADR-0006).
    """
    return await projects_service.get_owned(session, user.id, project_id)


OwnedProject = Annotated[Project, Depends(owned_project)]


async def owned_tour(
    tour_id: uuid.UUID,
    user: CurrentUser,
    session: PanelSession,
) -> Tour:
    """Тур владельца: одним запросом, с фильтром по владельцу в SQL."""
    return await tours_service.get_owned(session, user.id, tour_id)


OwnedTour = Annotated[Tour, Depends(owned_tour)]
