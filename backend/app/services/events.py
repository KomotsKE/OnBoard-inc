"""Приём событий прохождения туров.

Самый горячий путь после конфига: один `INSERT` на батч, без единого `SELECT`
перед ним. Дедупликация — `ON CONFLICT (event_id) DO NOTHING`: проверка
«а нет ли уже такого» на каждое событие означала бы лишний round-trip
(§12.7 docs/conventions.md, инвариант №8).
"""

import uuid
from urllib.parse import urlsplit

from pydantic import ValidationError
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event
from app.schemas.events import EventIn

# Столько места под путь в схеме (§3.3 docs/data-model.md).
URL_PATH_MAX = 200


def path_only(url: str | None) -> str | None:
    """Только путь: query не хранится никогда.

    В параметрах живут токены сброса пароля, адреса почты и идентификаторы
    сессий чужого сайта. Нам они не нужны, а хранить их — значит отвечать
    за них (инвариант №7).
    """
    if not url:
        return None
    path = urlsplit(url).path or "/"
    return path[:URL_PATH_MAX]


def parse(raw: list[dict]) -> tuple[list[EventIn], int]:
    """Разбирает события по одному. Возвращает годные и число отброшенных."""
    accepted: list[EventIn] = []
    dropped = 0
    for item in raw:
        try:
            accepted.append(EventIn.model_validate(item))
        except ValidationError:
            # Битое событие повтором не починится, поэтому ответ всё равно 204:
            # иначе виджет будет слать его по кругу (§7 docs/vision.md).
            dropped += 1
    return accepted, dropped


async def store(session: AsyncSession, project_id: uuid.UUID, events: list[EventIn]) -> int:
    """Пишет батч одним запросом. Возвращает число действительно новых строк."""
    if not events:
        return 0

    rows = [
        {
            "event_id": event.event_id,
            "project_id": project_id,
            "tour_id": event.tour_id,
            "step_id": event.step_id,
            "step_position": event.step_position,
            "run_id": event.run_id,
            "visitor_id": event.visitor_id,
            "type": event.type,
            "url_path": path_only(event.url),
            "device": event.device,
            "error_code": event.error_code,
        }
        for event in events
    ]

    statement = (
        insert(Event).on_conflict_do_nothing(index_elements=["event_id"]).returning(Event.event_id)
    )
    result = await session.execute(statement, rows)
    # Повторная доставка — норма для sendBeacon и для повтора после отказа сети,
    # поэтому дубли не ошибка: их просто не видно в результате.
    return len(result.scalars().all())
