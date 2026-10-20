"""Ограничение частоты запросов (§9.2 docs/vision.md).

Интерфейс отделён от реализации не ради абстракции, а потому что счётчики
в памяти процесса корректны только при одном воркере. Подмена на Redis —
вторая реализация того же протокола, без правок вызывающего кода
(§12.4 docs/conventions.md).
"""

import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Decision:
    allowed: bool
    retry_after_s: int = 0


class RateLimiter(Protocol):
    def allow(self, bucket: str, limit: int, window_s: int, *, record: bool = True) -> Decision:
        """`record=False` — только проверить остаток, не тратя попытку.

        Нужно там, где попытка считается не по факту запроса, а по его исходу:
        счётчик неудачных входов по адресу пополняется только при неверном пароле.
        """
        ...


class InMemoryRateLimiter:
    """Скользящее окно на отметках времени.

    Память ограничена сверху: в каждом бакете хранится не больше `limit`
    отметок, старые отбрасываются при обращении.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, bucket: str, limit: int, window_s: int, *, record: bool = True) -> Decision:
        now = time.monotonic()
        hits = self._hits[bucket]
        while hits and now - hits[0] >= window_s:
            hits.popleft()

        if len(hits) >= limit:
            retry_after = int(window_s - (now - hits[0])) + 1
            return Decision(allowed=False, retry_after_s=max(retry_after, 1))

        if record:
            hits.append(now)
        return Decision(allowed=True)


# Политики из §9.2 docs/vision.md. Логин защищён дважды: лимит только по IP
# не мешает подбирать пароль к одному аккаунту с распределённых адресов,
# а лимит только по email позволяет перебирать аккаунты с одного адреса.
#
# По IP лимит широкий: за одним адресом сидит целый офис за NAT, и десяток
# попыток на всех — это отказ в обслуживании своим же. Подбор пароля он всё
# равно не останавливает (30 попыток за 5 минут против 15-символьного пароля —
# ничто); останавливает его лимит по email ниже, он и есть защита аккаунта.
LOGIN_BY_IP = (30, 5 * 60)
LOGIN_FAILURES_BY_EMAIL = (5, 15 * 60)
REGISTER_BY_IP = (10, 60 * 60)
REFRESH_BY_IP = (60, 60)
# Публичный конфиг запрашивается раз на загрузку страницы, поэтому лимит на
# порядок выше панельных: он отсекает цикл в чужом коде, а не посетителей.
PUBLIC_CONFIG = (120, 60)
# Батчи событий: защита от случайного шторма, а не от злоумышленника —
# один посетитель за минуту столько не наберёт даже на длинном туре.
PUBLIC_EVENTS = (100, 60)
