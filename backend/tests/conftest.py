"""Общие фикстуры.

Тесты работают с отдельной базой (имя рабочей + `_test`): она создаётся при
первом прогоне и миграции применяются один раз на сессию. Каждый тест выполняется
во внешней транзакции, которая откатывается после него — включая запись, сделанную
приложением через HTTP, потому что сессии приложения подменяются на фабрику,
привязанную к тому же соединению.
"""

import os
from pathlib import Path

import httpx
import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from alembic import command
from app.core.config import get_settings
from app.main import app, lifespan

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _test_database_url() -> str:
    """Рабочая база с суффиксом `_test`: один источник параметров подключения
    и никакой возможности случайно работать с рабочими данными."""
    url = make_url(get_settings().database_url)
    name = url.database or ""
    if name.endswith("_test"):
        return url.render_as_string(hide_password=False)
    return url.set(database=f"{name}_test").render_as_string(hide_password=False)


def _create_database_if_missing(test_url: str) -> None:
    url = make_url(test_url)
    admin = create_engine(
        url.set(database="postgres").render_as_string(hide_password=False),
        isolation_level="AUTOCOMMIT",
        poolclass=None,
    )
    with admin.connect() as connection:
        exists = connection.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": url.database}
        ).scalar()
        if not exists:
            connection.execute(text(f'CREATE DATABASE "{url.database}"'))
    admin.dispose()


@pytest.fixture(scope="session", autouse=True)
def test_database() -> str:
    test_url = _test_database_url()
    assert (make_url(test_url).database or "").endswith("_test"), (
        "тесты обязаны работать с базой, имя которой заканчивается на _test"
    )

    _create_database_if_missing(test_url)

    # Приложение и Alembic читают адрес из настроек, поэтому подменяем его
    # до первого обращения и сбрасываем кэш.
    os.environ["ONBOARD_DATABASE_URL"] = test_url
    get_settings.cache_clear()

    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    command.upgrade(config, "head")

    return test_url


@pytest.fixture(scope="session")
async def engine(test_database: str):
    engine = create_async_engine(test_database)
    yield engine
    await engine.dispose()


@pytest.fixture
async def connection(engine):
    """Внешняя транзакция теста: всё, что в ней записано, откатывается."""
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            yield connection
        finally:
            await transaction.rollback()


@pytest.fixture
def session_factory(connection) -> async_sessionmaker[AsyncSession]:
    # join_transaction_mode="create_savepoint": сессия внутри уже открытой
    # транзакции работает на точке сохранения, поэтому её commit не фиксирует
    # данные окончательно и внешний откат убирает всё.
    return async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )


@pytest.fixture
async def db(session_factory) -> AsyncSession:
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(session_factory):
    """Клиент поверх ASGI: сеть не поднимается, но `lifespan` выполняется.

    Фабрика сессий приложения подменяется, чтобы запросы попадали в ту же
    транзакцию, что и тест, и тоже откатывались.
    """
    async with lifespan(app):
        app.state.sessionmaker = session_factory
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
