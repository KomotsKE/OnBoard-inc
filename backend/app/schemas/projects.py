"""Схемы проектов.

Лимиты — продуктовые, из §5 docs/data-model.md: в базе остаются только
ограничения, которые не изменятся (формат ключа, перечисления, абсурдные длины).
"""

import re
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

NAME_MAX = 200
ORIGINS_MAX = 20
PROJECTS_PER_USER = 10

ORIGIN_RE = re.compile(r"^https?://[a-z0-9.-]+(:\d{1,5})?$", re.IGNORECASE)
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class Page[T](BaseModel):
    """Конверт списковых ответов (§12.8 docs/conventions.md).

    Отдаётся с первого дня, даже там, где записей единицы: добавить пагинацию
    потом — это изменение контракта и правка каждого потребителя.
    """

    items: list[T]
    next_cursor: str | None = None


class Theme(BaseModel):
    """Оформление подсказки. Значения по умолчанию — §5.2 docs/data-model.md,
    контраст проверен по WCAG 2.2."""

    primary_color: Annotated[str, Field(pattern=COLOR_RE.pattern)] = "#2563EB"
    text_color: Annotated[str, Field(pattern=COLOR_RE.pattern)] = "#0F172A"
    backdrop_opacity: Annotated[float, Field(ge=0, le=1)] = 0.55
    border_radius: Annotated[str, Field(max_length=16)] = "8px"
    font_family: Annotated[str, Field(max_length=200)] = (
        'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    )
    next_label: Annotated[str, Field(min_length=1, max_length=40)] = "Далее"
    skip_label: Annotated[str, Field(min_length=1, max_length=40)] = "Пропустить"
    done_label: Annotated[str, Field(min_length=1, max_length=40)] = "Готово"


def _validate_origins(value: list[str]) -> list[str]:
    origins = [origin.strip().rstrip("/").lower() for origin in value]
    for origin in origins:
        if not ORIGIN_RE.match(origin):
            raise ValueError(f"origin должен быть вида https://example.com, получено {origin!r}")
    return origins


class ProjectCreate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=NAME_MAX)]


class ProjectUpdate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=NAME_MAX)] | None = None
    allowed_origins: Annotated[list[str], Field(max_length=ORIGINS_MAX)] | None = None
    theme: Theme | None = None

    @field_validator("allowed_origins")
    @classmethod
    def check_origins(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _validate_origins(value)


class ProjectRead(BaseModel):
    id: str
    name: str
    public_key: str
    allowed_origins: list[str]
    theme: Theme
    widget_connected: bool
    created_at: str


class SnippetResponse(BaseModel):
    snippet: str
