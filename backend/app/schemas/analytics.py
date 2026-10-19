"""Схемы воронки тура (§7.2 docs/vision.md, S9 docs/screens.md)."""

from typing import Literal

from pydantic import BaseModel

Range = Literal["7d", "30d"]

RANGE_DAYS: dict[Range, int] = {"7d": 7, "30d": 30}


class Totals(BaseModel):
    """Числа из критериев оценки: запуски, завершения, скипы — и что осталось."""

    runs: int
    completed: int
    skipped: int
    # Запуски минус завершения минус скипы: закрыл вкладку, ушёл со страницы.
    dropped: int
    completion_rate: float
    skip_rate: float


class FunnelStep(BaseModel):
    step_position: int
    step_id: str | None
    title: str
    selector: str
    runs: int
    # Доля от числа запусков тура.
    rate: float
    # Сколько потеряно между этим шагом и следующим; у последнего — между ним
    # и завершением тура.
    drop_off: float


class Issue(BaseModel):
    """Строка блока «Проблемы»: что именно сломалось и сколько раз."""

    type: Literal["step_target_missing", "widget_error"]
    step_position: int | None = None
    selector: str | None = None
    error_code: str | None = None
    count: int


class TourAnalytics(BaseModel):
    range: Range
    # Граница окна явно: тоталы и воронка считаются по одной и той же.
    since: str
    totals: Totals
    funnel: list[FunnelStep]
    # Шаг с наибольшей потерей — его подсвечивает экран (§7.3 docs/vision.md).
    problem_step: int | None
    issues: list[Issue]
