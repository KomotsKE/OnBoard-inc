"""Проверка самой тестовой инфраструктуры: запись из теста не доживает до
следующего и не попадает в рабочую базу.
"""

from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from tests.factories import make_project, make_user


async def test_writes_are_visible_inside_the_test(db):
    user = await make_user(db)
    await make_project(db, user_id=user["id"])

    users = await db.scalar(text("SELECT count(*) FROM users"))
    projects = await db.scalar(text("SELECT count(*) FROM projects"))

    assert users == 1
    assert projects == 1


async def test_previous_test_left_nothing(db):
    """Выполняется после предыдущего и видит пустые таблицы — значит внешняя
    транзакция откатилась."""
    users = await db.scalar(text("SELECT count(*) FROM users"))
    projects = await db.scalar(text("SELECT count(*) FROM projects"))

    assert users == 0
    assert projects == 0


async def test_commit_inside_test_is_also_rolled_back(db):
    """Сервисы коммитят сами, поэтому откат обязан переживать commit:
    сессия работает на точке сохранения внутри транзакции теста."""
    await make_user(db)
    await db.commit()

    assert await db.scalar(text("SELECT count(*) FROM users")) == 1


async def test_commit_from_previous_test_left_nothing(db):
    assert await db.scalar(text("SELECT count(*) FROM users")) == 0


async def test_tests_run_against_separate_database():
    name = make_url(get_settings().database_url).database or ""

    assert name.endswith("_test"), f"тесты подключены к {name!r}, а не к тестовой базе"


async def test_api_writes_share_the_test_transaction(client, db):
    """Запрос к приложению использует ту же транзакцию: пока нет пишущих
    эндпоинтов, достаточно убедиться, что приложение видит данные теста."""
    user = await make_user(db)

    response = await client.get("/health")

    assert response.status_code == 200
    assert (
        await db.scalar(text("SELECT count(*) FROM users WHERE id = :id"), {"id": user["id"]}) == 1
    )
