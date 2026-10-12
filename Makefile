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

up: ## поднять стек (postgres, api, panel, testsite)
	$(call STUB,T0.2)

down: ## остановить стек
	$(call STUB,T0.2)

logs: ## логи стека
	$(call STUB,T0.2)

migrate: ## применить миграции
	$(call STUB,T0.4)

revision: ## создать миграцию: make revision m="описание"
	$(call STUB,T0.4)

seed: ## наполнить БД демо-данными
	$(call STUB,T0.11)

test: ## pytest + vitest + tsc --noEmit
	$(call STUB,T0.5)

lint: ## ruff + tsc
	$(call STUB,T0.5)

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
