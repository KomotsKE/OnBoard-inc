"""Пароли и токены.

Хэширование argon2 намеренно дорого по процессору, поэтому выполняется в потоке:
в async-обработчике оно блокировало бы весь event loop (§12.5 docs/conventions.md).
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path

import jwt
from anyio import to_thread
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import Settings

_hasher = PasswordHasher()

WEAK_PASSWORDS_FILE = Path(__file__).resolve().parent.parent / "data" / "weak_passwords.txt"


@lru_cache
def weak_passwords() -> frozenset[str]:
    """Список известных утёкших паролей (SecLists, 10k-most-common).

    Проверка по такому списку — требование NIST SP 800-63B-4. При минимальной
    длине 15 символов он отсекает мало (§5.1 docs/data-model.md), но остаётся
    на случай снижения минимума при появлении второго фактора.
    """
    text = WEAK_PASSWORDS_FILE.read_text(encoding="utf-8", errors="replace")
    return frozenset(line.strip() for line in text.splitlines() if line.strip())


def is_weak(password: str) -> bool:
    return password.strip().lower() in weak_passwords()


async def hash_password(password: str) -> str:
    return await to_thread.run_sync(_hasher.hash, password)


async def verify_password(password_hash: str, password: str) -> bool:
    def check() -> bool:
        try:
            return _hasher.verify(password_hash, password)
        except VerifyMismatchError:
            return False

    return await to_thread.run_sync(check)


def create_access_token(settings: Settings, user_id: str) -> tuple[str, int]:
    """Возвращает токен и срок жизни в секундах."""
    ttl = timedelta(minutes=settings.access_token_ttl_min)
    now = datetime.now(UTC)
    payload = {"sub": user_id, "iat": now, "exp": now + ttl}
    token = jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm="HS256")
    return token, int(ttl.total_seconds())


def read_access_token(settings: Settings, token: str) -> str | None:
    """Идентификатор владельца из токена или None, если токен негоден."""
    try:
        payload = jwt.decode(token, settings.jwt_secret.get_secret_value(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    subject = payload.get("sub")
    return subject if isinstance(subject, str) else None


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def refresh_token_hash(token: str) -> bytes:
    """В базе лежит хэш: утечка дампа не даёт войти в чужой аккаунт."""
    return hashlib.sha256(token.encode("utf-8")).digest()
