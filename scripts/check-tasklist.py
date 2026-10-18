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
  * счётчики в блоке «Прогресс» совпадают с фактическим числом задач и закрытых;
  * галочки в чеклисте минимума MVP совпадают с состоянием задач, на которые
    ссылается строка. Это правило было записано словами («галочка ставится,
    когда закрыты соответствующие задачи») и ровно поэтому разошлось с планом
    на четырёх строках сразу.
"""

import re
import sys
from collections import Counter
from pathlib import Path

TASKLIST = Path(__file__).resolve().parent.parent / "docs" / "tasklist.md"

TASK_RE = re.compile(r"^- \[( |x|→)\] \*\*(T\d+\.\d+)[^*]*\*\*(.*?)(?=\n- \[|\n---|\n## )", re.S | re.M)
PROGRESS_RE = re.compile(r"^\| (\d+) — [^|]+\| (\d+) / (\d+) \|", re.M)
CURRENT_RE = re.compile(r"\*\*Текущая задача:\*\* ([^·]+)")
MINIMUM_RE = re.compile(r"^- \[( |x)\] (.+)$", re.M)
TASK_REF_RE = re.compile(r"T\d+\.\d+")
MINIMUM_HEADING = "## Чеклист минимума MVP"


def minimum_problems(text: str, statuses: dict[str, str]) -> list[str]:
    """Чеклист минимума MVP против фактического состояния задач.

    Строки без ссылок на задачи (например про README) пропускаются: их
    выполнение проверить скриптом нечем.
    """
    if MINIMUM_HEADING not in text:
        return ["нет раздела «Чеклист минимума MVP»"]

    section = text.split(MINIMUM_HEADING, 1)[1].split("\n## ", 1)[0]
    found = []
    for checked, line in MINIMUM_RE.findall(section):
        refs = [ref for ref in TASK_REF_RE.findall(line) if ref in statuses]
        if not refs:
            continue
        done = all(statuses[ref] == "x" for ref in refs)
        if done and checked != "x":
            found.append(f"минимум MVP: «{line[:48]}…» — задачи закрыты, галочки нет")
        if not done and checked == "x":
            open_refs = ", ".join(ref for ref in refs if statuses[ref] != "x")
            found.append(f"минимум MVP: «{line[:48]}…» отмечен, но {open_refs} не закрыты")
    return found


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

    problems += minimum_problems(text, {task_id: status for status, task_id, _ in tasks})

    if problems:
        print("docs/tasklist.md рассогласован:", file=sys.stderr)
        for problem in problems:
            print(f"  ✗ {problem}", file=sys.stderr)
        return 1

    print(f"✓ план согласован: {len(tasks)} задач, закрыто {sum(done.values())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
