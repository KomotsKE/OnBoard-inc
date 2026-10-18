.DEFAULT_GOAL := help
.PHONY: help up down logs migrate revision test e2e lint size seed \
	publish-backend publish-panel publish-widget

STUB = @echo "  не реализовано — задача $(1), см. docs/tasklist.md"

help: ## показать список целей
	@echo "OnBoard — доступные команды:"
	@echo
	@grep -E '^[a-z][a-zA-Z0-9_-]*:.*##' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*## "} {printf "  %-20s %s\n", $$1, $$2}'
	@echo
	@echo "Документы: docs/tasklist.md — план работ, CLAUDE.md — правила проекта"

env: ## создать .env из шаблона, если его нет
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "  создан .env из .env.example — проверьте значения перед первым запуском"; \
	fi

up: env ## поднять стек (postgres, стенд; api и panel — T0.3 и T0.6)
	docker compose up -d --wait
	@echo
	@docker compose ps
	@echo
	@echo "  стенд: http://localhost:$$(grep -E '^TESTSITE_PORT=' .env | cut -d= -f2)"

down: ## остановить стек (данные в томе pgdata сохраняются)
	docker compose down

logs: ## логи стека
	docker compose logs -f --tail=100

migrate: ## применить миграции
	docker compose run --rm migrate

revision: ## создать миграцию: make revision m="описание"
	@test -n "$(m)" || (echo '  укажите описание: make revision m="добавить туры"'; exit 1)
	docker compose run --rm --no-deps migrate alembic revision -m "$(m)"

seed: ## наполнить БД демо-данными
	$(call STUB,T0.11)

test: ## pytest + vitest + tsc --noEmit
	docker compose run --rm --no-deps api pytest

lint: ## ruff + tsc
	docker compose run --rm --no-deps api sh -c "ruff check . && ruff format --check ."

e2e: ## Playwright
	$(call STUB,T2.1)

size: ## бюджет размера бандлов виджета
	$(call STUB,T0.7)

publish-backend: ## зеркало backend/ во внешний репозиторий
	$(call STUB,T0.10)

publish-panel: ## зеркало panel/ во внешний репозиторий
	$(call STUB,T0.10)

publish-widget: ## зеркало widget/ во внешний репозиторий
	$(call STUB,T0.10)

hooks: ## установить git-хуки (pre-commit + commit-msg)
	@if command -v pre-commit >/dev/null 2>&1; then \
		pre-commit install --install-hooks; \
	elif [ -x .venv/bin/pre-commit ]; then \
		.venv/bin/pre-commit install --install-hooks; \
	else \
		echo "  pre-commit не найден. Один раз выполните:"; \
		echo "    python3 -m venv .venv && .venv/bin/pip install pre-commit && make hooks"; \
		exit 1; \
	fi

commits: ## проверить сообщения коммитов на Conventional Commits
	@scripts/check-commit-messages.sh $(RANGE)
