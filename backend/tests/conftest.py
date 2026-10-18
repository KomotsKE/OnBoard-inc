import httpx
import pytest

from app.main import app, lifespan


@pytest.fixture
async def client():
    """Асинхронный клиент поверх ASGI: сеть не поднимается, но `lifespan`
    выполняется, поэтому движок и пул создаются как в бою.

    `lifespan` вызывается напрямую вместо отдельной библиотеки-менеджера:
    он и так asynccontextmanager, а зависимость ради трёх строк не нужна.
    """
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
