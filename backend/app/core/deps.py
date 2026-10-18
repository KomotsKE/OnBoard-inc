"""Зависимости FastAPI. Изоляция арендаторов (`get_owned_*`) добавляется
вместе с первым приватным ресурсом в T1.2, а не дописывается потом.
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import open_session


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
