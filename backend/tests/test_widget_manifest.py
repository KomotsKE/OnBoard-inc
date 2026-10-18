"""Чтение манифеста сборки виджета (ADR-0009)."""

import json
import os

from app.core.widget_manifest import WidgetManifest


def test_reads_core_file_name(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({"core": "core.abc1234567.js"}), encoding="utf-8")

    assert WidgetManifest(path).core_file() == "core.abc1234567.js"


def test_missing_file_is_not_an_error(tmp_path):
    """Виджет мог ещё не собраться — это состояние, а не исключение."""
    assert WidgetManifest(tmp_path / "нет.json").core_file() is None


def test_broken_json_gives_none(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text("{не json", encoding="utf-8")

    assert WidgetManifest(path).core_file() is None


def test_rebuild_is_picked_up_without_restart(tmp_path):
    """Главное свойство: новый хэш ядра виден без перезапуска API."""
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({"core": "core.aaaaaaaaaa.js"}), encoding="utf-8")
    manifest = WidgetManifest(path)
    assert manifest.core_file() == "core.aaaaaaaaaa.js"

    # mtime у файловых систем бывает с грубым разрешением, поэтому сдвигаем его
    # явно, а не рассчитываем на разницу во времени записи.
    path.write_text(json.dumps({"core": "core.bbbbbbbbbb.js"}), encoding="utf-8")
    stat = path.stat()
    os.utime(path, (stat.st_atime, stat.st_mtime + 10))

    assert manifest.core_file() == "core.bbbbbbbbbb.js"
