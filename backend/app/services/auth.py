"""Аутентификация владельцев сайтов.

Сервис не знает про HTTP: поднимает доменные исключения, получает `AsyncSession`
и не коммитит сам — транзакцией управляет обработчик (§4.5 docs/vision.md).
Записи журнала делаются после успешного коммита, поэтому логирование вызывает
слой API, а не этот модуль.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ConflictError, UnauthorizedError, ValidationError
from app.core.security import (
    create_access_token,
    hash_password,
    is_weak,
    new_refresh_token,
    refresh_token_hash,
    verify_password,
)
from app.models import RefreshSession, User


@dataclass(frozen=True)
class Session:
    """Результат входа: access-токен отдаётся в теле, refresh — в cookie."""

    user: User
    access_token: str
    expires_in: int
    refresh_token: str


async def register(session: AsyncSession, settings: Settings, email: str, password: str) -> Session:
    if is_weak(password):
        raise ValidationError("этот пароль есть в списке известных утёкших паролей")

    user = User(email=email, password_hash=await hash_password(password))
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ConflictError("такой адрес уже зарегистрирован") from exc

    return await _issue(session, settings, user)


async def login(session: AsyncSession, settings: Settings, email: str, password: str) -> Session:
    user = await session.scalar(select(User).where(User.email == email))

    # Один и тот же ответ на неизвестный адрес и на неверный пароль: иначе
    # форма входа превращается в список существующих аккаунтов.
    if user is None or not await verify_password(user.password_hash, password):
        raise UnauthorizedError("неверный адрес или пароль")

    return await _issue(session, settings, user)


async def refresh(session: AsyncSession, settings: Settings, token: str) -> Session:
    stored = await session.scalar(
        select(RefreshSession).where(RefreshSession.token_hash == refresh_token_hash(token))
    )
    if stored is None:
        raise UnauthorizedError("токен обновления недействителен")

    now = datetime.now(UTC)

    if stored.used_at is not None:
        # Токен предъявлен второй раз — значит он украден: гасим всю цепочку
        # этого входа, а не только эту строку (ADR-0008).
        await _revoke_family(session, stored.family_id, now)

        # Единственное место, где сервис коммитит сам. Обычно транзакцией
        # управляет обработчик, но здесь дальше поднимается 401, и общий откат
        # отменил бы отзыв токенов: кража была бы записана в журнал, а доступ
        # остался бы живым. Проверяется тестом на повторное использование.
        await session.commit()

        logging.getLogger("onboard").error(
            "auth.refresh.reuse_detected",
            extra={"user_id": str(stored.user_id), "family_id": str(stored.family_id)},
        )
        raise UnauthorizedError("токен обновления уже использован, сессия закрыта")

    if stored.revoked_at is not None or stored.expires_at <= now:
        raise UnauthorizedError("токен обновления недействителен")

    stored.used_at = now
    user = await session.get(User, stored.user_id)
    if user is None:
        raise UnauthorizedError("токен обновления недействителен")

    return await _issue(session, settings, user, family_id=stored.family_id)


async def logout(session: AsyncSession, token: str) -> None:
    """Выход гасит цепочку: чистка памяти на клиенте сессию не закрывает."""
    stored = await session.scalar(
        select(RefreshSession).where(RefreshSession.token_hash == refresh_token_hash(token))
    )
    if stored is not None:
        await _revoke_family(session, stored.family_id, datetime.now(UTC))


async def _issue(
    session: AsyncSession,
    settings: Settings,
    user: User,
    *,
    family_id: uuid.UUID | None = None,
) -> Session:
    token = new_refresh_token()
    session.add(
        RefreshSession(
            user_id=user.id,
            family_id=family_id or uuid.uuid4(),
            token_hash=refresh_token_hash(token),
            expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days),
        )
    )
    await session.flush()

    access_token, expires_in = create_access_token(settings, str(user.id))
    return Session(user=user, access_token=access_token, expires_in=expires_in, refresh_token=token)


async def _revoke_family(session: AsyncSession, family_id: uuid.UUID, now: datetime) -> None:
    await session.execute(
        update(RefreshSession)
        .where(RefreshSession.family_id == family_id, RefreshSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
