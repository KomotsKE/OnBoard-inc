"""Фабрики тестовых данных.

Тела тестов не заполняют базу вручную (§7 docs/conventions.md). Пока моделей нет,
вставка идёт через Core; с появлением моделей в T1.1 фабрики переедут на них,
а подписи останутся теми же.
"""

import secrets
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def public_key() -> str:
    """Формат проверяется ограничением `projects_key_fmt`."""
    return "pk_" + secrets.token_hex(16)


async def make_user(
    session: AsyncSession,
    *,
    email: str | None = None,
    password_hash: str = "argon2-заглушка",
) -> dict[str, Any]:
    values = {
        "id": uuid.uuid4(),
        # Уникальный адрес по умолчанию: тесты не должны мешать друг другу,
        # даже если откат почему-то не сработал.
        "email": email or f"user-{uuid.uuid4().hex[:12]}@example.test",
        "password_hash": password_hash,
    }
    await session.execute(
        text("INSERT INTO users (id, email, password_hash) VALUES (:id, :email, :password_hash)"),
        values,
    )
    return values


async def make_project(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    name: str = "Тестовый проект",
    allowed_origins: list[str] | None = None,
) -> dict[str, Any]:
    values = {
        "id": uuid.uuid4(),
        "user_id": user_id,
        "name": name,
        "public_key": public_key(),
        "allowed_origins": allowed_origins or [],
    }
    await session.execute(
        text(
            "INSERT INTO projects (id, user_id, name, public_key, allowed_origins)"
            " VALUES (:id, :user_id, :name, :public_key, :allowed_origins)"
        ),
        values,
    )
    return values
