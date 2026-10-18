import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import open_session
from app.main import app, lifespan


async def test_public_statement_timeout_aborts_long_query():
    """Запрос дольше таймаута публичного контура обрывается, а не висит.

    Берём 3 секунды против таймаута в 2000 мс (§9.1 docs/vision.md).
    """
    async with lifespan(app):
        factory = app.state.sessionmaker
        timeout_ms = app.state.settings.db_statement_timeout_public_ms

        with pytest.raises(DBAPIError) as exc:
            async with open_session(factory, timeout_ms) as session:
                await session.execute(text("SELECT pg_sleep(3)"))

    assert "canceling statement" in str(exc.value).lower()


async def test_panel_timeout_is_looser_than_public():
    async with lifespan(app):
        settings = app.state.settings

    assert settings.db_statement_timeout_panel_ms > settings.db_statement_timeout_public_ms
