#!/usr/bin/env bash
# Проверяет сообщения коммитов в диапазоне на соответствие Conventional Commits.
# Локально хук commit-msg делает то же для каждого коммита; этот скрипт — защита
# истории в CI, где коммиты могли прийти в обход хуков.
#
# Использование: scripts/check-commit-messages.sh [<диапазон git>]
set -euo pipefail

RANGE="${1:-}"
# если диапазон не задан или не разрешается (например, в репозитории один коммит) —
# проверяем всю историю
if [ -z "$RANGE" ] || ! git rev-list --quiet "$RANGE" 2>/dev/null; then
    RANGE="HEAD"
fi
TYPES='feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'
PATTERN="^(${TYPES})(\([a-z0-9-]+\))?!?: .{1,72}$"

failed=0
while IFS= read -r subject; do
    [ -z "$subject" ] && continue
    # merge-коммиты не подчиняются Conventional Commits
    case "$subject" in "Merge "*) continue ;; esac
    if ! printf '%s' "$subject" | grep -Eq "$PATTERN"; then
        echo "✗ не Conventional Commits: ${subject}"
        failed=1
    else
        echo "✓ ${subject}"
    fi
done < <(git log --no-merges --format=%s "$RANGE")

if [ "$failed" -ne 0 ]; then
    echo
    echo "Формат: <type>(<scope>): <описание до 72 символов>"
    echo "Типы:   ${TYPES//|/, }"
    echo "Скоупы: backend, panel, widget, testsite, e2e, docs, infra, deps, repo"
    exit 1
fi
