"""Схемы публичного контура: то, что получает виджет на сайте клиента.

Отдельно от схем панели: публичный ответ не должен расширяться вслед за
внутренним контрактом. `StepRead` переиспользован — набор полей шага у панели
и у виджета один и тот же; разойдутся — разделим (правило трёх, §9 conventions.md).
"""

from pydantic import BaseModel

from app.schemas.projects import Theme
from app.schemas.tours import StepRead

# Длина адреса страницы с запасом: в конфиг приходит pathname + search сайта
# клиента, и query там бывает длинным.
URL_MAX = 2000

PUBLIC_KEY_PATTERN = r"^pk_[0-9a-f]{32}$"


class PublicProject(BaseModel):
    """Всё, что виджету нужно знать о проекте. Ни имени, ни ключей, ни доменов."""

    theme: Theme


class PublicTour(BaseModel):
    id: str
    name: str
    show_once: bool
    steps: list[StepRead]


class WidgetConfig(BaseModel):
    """Один запрос — всё, что нужно для показа тура (§8.1 docs/vision.md).

    `tour: null` — штатный ответ для страницы, где показывать нечего: загрузчик
    по нему решает не грузить ядро вовсе.
    """

    core_url: str
    project: PublicProject
    tour: PublicTour | None
