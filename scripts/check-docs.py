#!/usr/bin/env python3
"""Команды из документации существуют в Makefile.

Документ, который советует несуществующую команду, хуже отсутствующего: он
тратит время того, кто ему поверил. Цели переименовывались уже трижды, поэтому
сверка автоматическая, а не «не забыть проверить».
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET_RE = re.compile(r"^([a-z][a-zA-Z0-9_-]*):", re.M)
MENTION_RE = re.compile(r"\bmake ([a-z][a-zA-Z0-9_-]*)")

# Слова, которые идут после «make» в обычной речи, а не как цель.
NOT_TARGETS = {"sure", "it"}


def documents() -> list[Path]:
    files = [ROOT / "README.md", ROOT / "CLAUDE.md"]
    files += sorted(ROOT.glob("docs/**/*.md"))
    files += sorted(path / "README.md" for path in ROOT.iterdir() if (path / "README.md").is_file())
    return [path for path in files if path.is_file()]


def main() -> int:
    targets = set(TARGET_RE.findall((ROOT / "Makefile").read_text(encoding="utf-8")))
    problems: list[str] = []
    checked = 0

    for document in documents():
        text = document.read_text(encoding="utf-8")
        for mention in sorted(set(MENTION_RE.findall(text))):
            if mention in NOT_TARGETS:
                continue
            checked += 1
            if mention not in targets:
                problems.append(f"{document.relative_to(ROOT)}: нет цели «make {mention}»")

    if problems:
        print("документация ссылается на несуществующие команды:", file=sys.stderr)
        for problem in problems:
            print(f"  ✗ {problem}", file=sys.stderr)
        return 1

    print(f"✓ команды в документации существуют: {checked} упоминаний, {len(targets)} целей")
    return 0


if __name__ == "__main__":
    sys.exit(main())
