"""Схемы туров и шагов."""

import re
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

NAME_MAX = 200
# Длина регулярного выражения ограничена отдельно: это простая защита от
# катастрофического бэктрекинга, которую не обойти проверкой компилируемости.
REGEX_VALUE_MAX = 200
MATCH_VALUE_MAX = 500

Placement = Literal["auto", "top", "bottom", "left", "right"]
MatchMode = Literal["exact", "contains", "prefix", "regex"]
Status = Literal["draft", "published", "archived"]


class UrlMatch(BaseModel):
    """Условие показа. Сравнивается с `pathname + search` (§6 docs/vision.md)."""

    mode: MatchMode = "contains"
    value: Annotated[str, Field(min_length=1, max_length=MATCH_VALUE_MAX)] = "/"

    @model_validator(mode="after")
    def check_regex(self) -> "UrlMatch":
        if self.mode != "regex":
            return self
        if len(self.value) > REGEX_VALUE_MAX:
            raise ValueError(f"регулярное выражение длиннее {REGEX_VALUE_MAX} символов")
        try:
            re.compile(self.value)
        except re.error as exc:
            raise ValueError(f"некорректное регулярное выражение: {exc}") from exc
        return self


class StepRead(BaseModel):
    id: str
    position: int
    selector: str
    title: str
    body: str
    placement: Placement


class TourCreate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=NAME_MAX)]
    url_match: UrlMatch = UrlMatch()
    show_once: bool = True


class TourUpdate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=NAME_MAX)] | None = None
    url_match: UrlMatch | None = None
    show_once: bool | None = None


class TourRead(BaseModel):
    """Тур вместе со шагами: конструктор без них бесполезен, а два запроса
    дают мигание интерфейса и две точки отказа (§6 docs/screens.md)."""

    id: str
    name: str
    status: Status
    url_match: UrlMatch
    show_once: bool
    published_at: str | None
    steps: list[StepRead]


class TourListItem(BaseModel):
    """Строка списка туров: метрики приходят в том же ответе, иначе список
    из двадцати туров дал бы двадцать запросов аналитики."""

    id: str
    name: str
    status: Status
    url_match: UrlMatch
    show_once: bool
    published_at: str | None
    steps_count: int
    runs_7d: int
    completion_rate_7d: float
