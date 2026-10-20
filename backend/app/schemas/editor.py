"""Схемы режима редактора (ADR-0004)."""

from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator

from app.schemas.projects import Theme
from app.schemas.tours import StepCreate, StepRead, StepUpdate

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


class EditorTour(BaseModel):
    """Тур глазами редактора: имя нужно, чтобы владелец видел, что правит."""

    id: str
    name: str


class EditorState(BaseModel):
    """Всё, что редактор получает при входе: один запрос вместо трёх.

    Тема отдаётся, потому что подсказка в редакторе обязана выглядеть так же,
    как у посетителя, — иначе владелец подбирает текст под чужой вид.
    """

    mode: Mode
    # Загрузчик на странице знает только токен: имя файла редактора с хэшем
    # сборки берётся отсюда, как core_url у конфига (ADR-0009).
    editor_url: str
    tour: EditorTour
    steps: list[StepRead]
    theme: Theme


class EditorStepCreate(BaseModel):
    token: str
    step: StepCreate


class EditorStepUpdate(BaseModel):
    token: str
    step: StepUpdate
