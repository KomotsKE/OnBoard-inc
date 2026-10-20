"""Схемы режима редактора (ADR-0004)."""

from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator

# Предел адреса: у браузеров он около 2000 символов, длиннее страница всё равно
# не откроется.
PAGE_URL_MAX = 2000

Mode = Literal["edit", "preview"]


class EditorSessionCreate(BaseModel):
    """Адрес страницы владелец вводит сам: в проекте хранятся только разрешённые
    домены, а выбирать элементы нужно на конкретной странице."""

    page_url: Annotated[str, Field(min_length=1, max_length=PAGE_URL_MAX)]
    mode: Mode = "edit"

    @field_validator("page_url")
    @classmethod
    def check_absolute_http_url(cls, value: str) -> str:
        parts = urlsplit(value.strip())
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError("адрес страницы должен быть вида https://example.com/страница")
        return value.strip()


class EditorSession(BaseModel):
    url: str
    expires_in: int
