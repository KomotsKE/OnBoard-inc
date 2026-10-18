"""Движок и сессии (§12.1 docs/conventions.md).

Движок создаётся один раз в lifespan приложения: создание на запрос означало бы
новый TCP-коннект и новый handshake на каждый вызов. Параметры пула заданы явно —
дефолтный `pool_timeout` в 30 секунд под нагрузкой превращается в очередь
запросов вместо честного быстрого отказа.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_s,
        pool_recycle=settings.db_pool_recycle_s,
        pool_pre_ping=True,
    )


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@asynccontextmanager
async def open_session(
    factory: async_sessionmaker[AsyncSession],
    statement_timeout_ms: int,
) -> AsyncIterator[AsyncSession]:
    """Одна транзакция на запрос: успешный выход коммитит, исключение откатывает.

    `statement_timeout` ставится на транзакцию: у публичных маршрутов он строже,
    чем у панельных (§9.1 docs/vision.md). `SET LOCAL` не принимает параметры
    подстановки, поэтому значение приводится к int и вставляется в текст.
    """
    async with factory() as session, session.begin():
        await session.execute(text(f"SET LOCAL statement_timeout = {int(statement_timeout_ms)}"))
        yield session
