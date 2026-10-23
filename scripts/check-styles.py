#!/usr/bin/env python3
"""Проверка контракта токенов в panel/src/styles.css.

Значения оформления приходят из дизайн-системы OnBoard и живут в одном месте —
блоках `:root`. Проверка нужна потому, что правило «цвет только через токен»
словами уже нарушалось: по файлу было разбросано девятнадцать сырых значений,
и тема не действовала ни на одно из них.

Проверяется:
  * объявлен каждый токен, на который опирается разметка;
  * тёмная тема переопределяет ровно тот же набор цветов, что и светлая;
  * значения виджета (`--onboard-*`) в тёмной теме не меняются: превью
    подсказки показывает чужой сайт, где темы панели нет (§4.6 vision.md);
  * в правилах не осталось ни сырого цвета, ни тени мимо токена.
"""

import re
import sys
from pathlib import Path

STYLES = Path(__file__).resolve().parent.parent / "panel" / "src" / "styles.css"

TOKENS = (
    "--surface --surface-muted --surface-sunken --ink --ink-muted --ink-subtle "
    "--border --border-strong --accent --accent-ink --success --success-soft "
    "--warning --danger --danger-soft "
    "--scrim --scrim-strong --on-photo "
    "--space-1 --space-2 --space-3 --space-4 --space-5 --space-6 "
    "--radius-sm --radius-md --radius-lg --radius-pill "
    "--shadow-card --shadow-tooltip --font-sans --font-mono"
).split()

ALIASES = ("--onboard-radius", "--onboard-font", "--panel-border", "--panel-space")

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
THEME_RE = re.compile(r":root\s*\{[^}]*\}")
COLOR_RE = re.compile(r"#[0-9a-f]{3,8}\b|\brgba?\(", re.I)
COLOR_TOKEN_RE = re.compile(r"(--[a-z0-9-]+):\s*(?:#[0-9a-f]{3,8}|rgba?\()", re.I)
SHADOW_RE = re.compile(r"box-shadow:\s*([^;]+);")


def main() -> int:
    text = COMMENT_RE.sub("", STYLES.read_text(encoding="utf-8"))
    themes = THEME_RE.findall(text)
    rules = THEME_RE.sub("", text)
    problems: list[str] = []

    if len(themes) < 2:
        problems.append("нет блока тёмной темы: ожидались :root и @media prefers-color-scheme")
        themes = themes + [""] * (2 - len(themes))

    declared = "\n".join(themes)
    for token in TOKENS:
        if f"{token}:" not in declared:
            problems.append(f"токен не объявлен: {token}")

    for alias in ALIASES:
        if not re.search(rf"{alias}:\s*var\(", declared):
            problems.append(f"{alias} должен быть псевдонимом токена, а не значением")

    def colors(block: str) -> list[str]:
        found = COLOR_TOKEN_RE.findall(block)
        return sorted(name for name in found if not name.startswith("--onboard-"))

    if colors(themes[0]) != colors(themes[1]):
        missing = set(colors(themes[0])) ^ set(colors(themes[1]))
        problems.append(f"темы расходятся по цветам: {', '.join(sorted(missing))}")

    if "--onboard-" in themes[1]:
        problems.append("тёмная тема переопределяет значения виджета — превью разойдётся с сайтом")

    raw = COLOR_RE.findall(rules)
    if raw:
        problems.append(f"цвет мимо токена ({len(raw)}): {', '.join(sorted(set(raw)))}")

    shadows = [value.strip() for value in SHADOW_RE.findall(rules)]
    stray = [value for value in shadows if not value.startswith("var(")]
    if stray:
        problems.append(f"тень мимо токена: {'; '.join(stray)}")

    if problems:
        print("стили панели:", file=sys.stderr)
        for problem in problems:
            print(f"  ✗ {problem}", file=sys.stderr)
        return 1

    print(f"✓ стили согласованы: {len(TOKENS)} токенов, две темы, сырых значений нет")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
