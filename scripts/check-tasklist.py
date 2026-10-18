#!/usr/bin/env python3
"""Проверка целостности docs/tasklist.md.

Нужна потому, что план — единственный источник правды о том, где мы находимся,
и новая сессия начинает работу с него. Расхождение между счётчиками, отметкой
задачи в работе и строкой «Текущая задача» дороже, чем кажется: следующая
сессия берётся не за то или делает заново сделанное.

Проверяется:
  * у каждой задачи есть строка «проверка:» — иначе она не закрываема;
  * в работе не больше одной задачи (статус `[→]`);
  * строка «Текущая задача» согласована с этой отметкой;
  * счётчики в блоке «Прогресс» совпадают с фактическим числом задач и закрытых.
"""

import re
import sys
from collections import Counter
from pathlib import Path

TASKLIST = Path(__file__).resolve().parent.parent / "docs" / "tasklist.md"

TASK_RE = re.compile(r"^- \[( |x|→)\] \*\*(T\d+\.\d+)[^*]*\*\*(.*?)(?=\n- \[|\n---|\n## )", re.S | re.M)
PROGRESS_RE = re.compile(r"^\| (\d+) — [^|]+\| (\d+) / (\d+) \|", re.M)
CURRENT_RE = re.compile(r"\*\*Текущая задача:\*\* ([^·]+)")


def main() -> int:
    text = TASKLIST.read_text(encoding="utf-8")
    tasks = TASK_RE.findall(text)
    problems: list[str] = []

    if not tasks:
        print("не нашёл ни одной задачи — формат плана изменился?", file=sys.stderr)
        return 1

    for status, task_id, body in tasks:
        if "проверка:" not in body:
            problems.append(f"{task_id}: нет строки «проверка:»")

    in_progress = [task_id for status, task_id, _ in tasks if status == "→"]
    if len(in_progress) > 1:
        problems.append(f"в работе больше одной задачи: {', '.join(in_progress)}")

    current = CURRENT_RE.search(text)
    if current is None:
        problems.append("нет строки «Текущая задача»")
    elif in_progress and in_progress[0] not in current.group(1):
        problems.append(
            f"«Текущая задача» ({current.group(1).strip()}) расходится с отметкой [→] "
            f"у {in_progress[0]}"
        )

    done = Counter()
    total = Counter()
    for status, task_id, _ in tasks:
        stage = task_id.split(".")[0][1:]
        total[stage] += 1
        if status == "x":
            done[stage] += 1

    for stage, claimed_done, claimed_total in PROGRESS_RE.findall(text):
        if (int(claimed_done), int(claimed_total)) != (done[stage], total[stage]):
            problems.append(
                f"этап {stage}: в блоке «Прогресс» {claimed_done} / {claimed_total}, "
                f"фактически {done[stage]} / {total[stage]}"
            )

    if problems:
        print("docs/tasklist.md рассогласован:", file=sys.stderr)
        for problem in problems:
            print(f"  ✗ {problem}", file=sys.stderr)
        return 1

    print(f"✓ план согласован: {len(tasks)} задач, закрыто {sum(done.values())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
