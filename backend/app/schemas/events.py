"""Схемы приёма событий (§7.1 docs/vision.md).

Событие приходит от чужой страницы, поэтому проверяется строго: лишние поля
отбрасываются, перечисления закрыты, длины ограничены. Невалидное событие не
роняет батч — его молча отбрасывают, иначе виджет начнёт повторять то, что
повтором не чинится.
"""

from typing import Annotated, Literal

from pydantic import UUID4, BaseModel, ConfigDict, Field

EventType = Literal[
    "tour_started",
    "step_viewed",
    "step_back",
    "tour_skipped",
    "tour_completed",
    "step_target_missing",
    "widget_error",
    "widget_ping",
]

# Коды закрытым списком — §7.1 docs/vision.md.
ErrorCode = Literal[
    "target_timeout",
    "config_fetch_failed",
    "render_failed",
    "storage_unavailable",
    "unexpected",
]

Device = Literal["desktop", "mobile", "tablet"]

URL_MAX = 2000
# Сколько событий принимаем за раз. Виджет шлёт десятками; потолок защищает
# от случайного шторма и от батча, который не влезет в один INSERT.
BATCH_MAX = 100
PUBLIC_KEY_PATTERN = r"^pk_[0-9a-f]{32}$"


class EventIn(BaseModel):
    """Одно событие. Поля сверх перечисленных игнорируются."""

    model_config = ConfigDict(extra="ignore")

    event_id: UUID4
    type: EventType
    tour_id: UUID4 | None = None
    step_id: UUID4 | None = None
    step_position: Annotated[int, Field(ge=0, le=199)] | None = None
    run_id: UUID4 | None = None
    visitor_id: UUID4 | None = None
    # Полный адрес страницы: на сервере от него остаётся только путь, query
    # отбрасывается (инвариант №7 — в параметрах бывают токены и адреса почты).
    url: Annotated[str, Field(max_length=URL_MAX)] | None = None
    device: Device | None = None
    error_code: ErrorCode | None = None


class EventBatch(BaseModel):
    """Конверт батча. События остаются сырыми: каждое проверяется по отдельности."""

    model_config = ConfigDict(extra="ignore")

    key: Annotated[str, Field(pattern=PUBLIC_KEY_PATTERN)]
    events: Annotated[list[dict], Field(max_length=BATCH_MAX)]
