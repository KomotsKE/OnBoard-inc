"""Адрес ядра виджета из manifest.json его сборки (ADR-0009).

Ядро лежит под именем с хэшем содержимого, и точный адрес знает только
сборка. Публичный конфиг берёт его отсюда, поэтому обновление ядра не требует
правок в сниппете у клиента.

Файл перечитывается, только если изменилось время модификации: виджет
собирается отдельным контейнером, и перезапуск API ради нового хэша означал бы
простой. На горячем пути остаётся один `stat` вместо чтения и разбора JSON.
"""

import json
from pathlib import Path


class WidgetManifest:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._mtime: float | None = None
        self._files: dict[str, str] = {}

    def core_file(self) -> str | None:
        """Имя файла ядра или None, если манифеста нет или он битый.

        None — рабочее состояние, а не ошибка: виджет мог ещё не собраться.
        Решение, что делать дальше, принимает вызывающий код.
        """
        return self._load().get("core")

    def editor_file(self) -> str | None:
        """Имя файла редактора. None на тех же основаниях, что и у ядра."""
        return self._load().get("editor")

    def _load(self) -> dict[str, str]:
        try:
            mtime = self._path.stat().st_mtime
        except OSError:
            self._mtime, self._files = None, {}
            return self._files

        if mtime != self._mtime:
            try:
                content = json.loads(self._path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                content = {}
            self._files = {name: value for name, value in content.items() if isinstance(value, str)}
            self._mtime = mtime
        return self._files
