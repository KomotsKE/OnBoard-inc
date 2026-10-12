# OnBoard — правила проекта

Платформа интерактивного онбординга: встраиваемый JS-виджет для сайтов клиентов +
личный кабинет для сборки туров и аналитики.

## Документы проекта

| Файл | Отвечает на вопрос |
|---|---|
| [docs/idea.md](docs/idea.md) | что и для кого делаем, границы MVP, критерии заказчика |
| [docs/vision.md](docs/vision.md) | как устроена система: архитектура, модель данных, API, НФТ |
| [docs/adr/](docs/adr/) | почему принято именно это решение и что отвергли |
| [docs/conventions.md](docs/conventions.md) | как писать код: структура, стиль, запреты |
| [docs/workflow.md](docs/workflow.md) | как мы работаем: цикл задачи, проверки, DoD |
| [docs/tasklist.md](docs/tasklist.md) | где мы сейчас и что следующее |
| [docs/guides/](docs/guides/) | пошаговые инструкции по окружению |

Репозиторий один; `backend/`, `panel/` и `widget/` публикуются наружу как зеркала
поддеревьев ([ADR-0007](docs/adr/0007-monorepo-with-subtree-publishing.md)). Коммит
по задаче может затрагивать несколько компонентов — так и задумано.

**Начало работы:** прочитать `docs/tasklist.md`, взять первую задачу со статусом `[→]`,
не брать следующую, пока текущая не закрыта. Перед кодом прочитать
`docs/conventions.md`.

## Порядок работы над задачей

```
план (3–6 строк) → ваше подтверждение → тест → код → запуск проверки
   → дифф и отчёт → ваша приёмка → отметка в tasklist.md → коммит по просьбе
```

Контрольные точки обязательны: после плана и после диффа я останавливаюсь и жду
подтверждения. «Готово» не произносится, пока не выполнена команда из строки
`проверка:` у задачи. Подробно — [docs/workflow.md](docs/workflow.md).

## Стек (зафиксирован)

Бэкенд: Python 3.12, FastAPI, SQLAlchemy 2.0 (sync), Alembic, PostgreSQL 16.
Панель: React 18 + TypeScript, Vite, TanStack Query. Виджет: TypeScript, esbuild,
ноль рантайм-зависимостей. Тесты: pytest + httpx, vitest, Playwright.
Инфра: docker-compose + Makefile.

Разрешённые зависимости:

- бэкенд: `fastapi uvicorn sqlalchemy alembic psycopg[binary] pydantic-settings pyjwt
  argon2-cffi python-multipart` + dev: `pytest httpx ruff`;
- панель: `react react-dom react-router-dom @tanstack/react-query @dnd-kit/core
  @dnd-kit/sortable` + dev: `typescript vite @vitejs/plugin-react vitest`;
- виджет: рантайм-зависимостей нет; dev: `typescript esbuild size-limit vitest jsdom`;
- e2e: `@playwright/test`.

Всё остальное — только после согласования.

## Команды

```
make up / make down / make logs      docker-compose
make migrate / make revision m="…"   alembic
make test                            pytest + vitest + tsc --noEmit
make e2e                             Playwright
make lint                            ruff + tsc
make size                            бюджет размера бандлов виджета
make publish-backend / -panel / -widget   зеркала поддеревьев во внешние репозитории
```

Новая функциональность должна проверяться одной из этих команд. Нет команды — нет проверки.

## Инварианты (нарушение = блокер, не «доработаем потом»)

1. **Виджет не имеет права сломать сайт клиента.** Каждая публичная точка входа
   обёрнута в `try/catch`; ошибка гасится в `console.debug`. Необработанное исключение
   нашего кода на чужом сайте — инцидент у клиента.
2. **Не вмешиваемся в DOM и стили клиента.** Весь UI — в Shadow DOM под одним хостом
   в `<body>`; подсветка — SVG-маска. Чужие элементы, их классы, атрибуты и `z-index`
   не меняем. ([ADR-0002](docs/adr/0002-shadow-dom-ui.md), [ADR-0003](docs/adr/0003-svg-mask-highlight.md))
3. **Один глобал** — `window.OnBoard`. Встроенные объекты не патчим; исключение —
   обёртка над `history.pushState` для SPA, с вызовом оригинала.
4. **Изоляция арендаторов — в слое запроса.** `user_id` из JWT подставляется в SQL;
   чужой объект → **404**. ([ADR-0006](docs/adr/0006-tenant-isolation-404.md))
5. **Бюджет размера:** `loader.js` ≤ 5 КБ, `core.js` ≤ 30 КБ, `editor.js` ≤ 20 КБ gzip,
   проверяется `make size`. ([ADR-0001](docs/adr/0001-two-stage-widget-loading.md))
6. **Пользовательский текст — через `textContent`.** Никакого `innerHTML`.
7. **Без PII:** ни IP, ни email конечных пользователей, ни сырой User-Agent в БД.
8. **Ingest событий идемпотентен** по `event_id` (`ON CONFLICT DO NOTHING`).
9. **Схема БД — только через Alembic**, с рабочим `downgrade`.
10. **Без i18n:** интерфейс только русский, строки прямо в компонентах.
11. **Access-токен панели — только в памяти**, refresh — только в httpOnly cookie.
    В `localStorage` панели не хранится ничего, кроме UI-мелочей.
    ([ADR-0008](docs/adr/0008-session-storage.md))

## Границы изменений

- Правим только то, что требует текущая задача. Соседний код, форматирование и
  комментарии не «улучшаем».
- Заметили несвязанную проблему — пишем в «Замечания» в `docs/tasklist.md`,
  не исправляем молча.
- Фичи сверх задачи не добавляем. Абстракции под одно использование не создаём.
- Архитектурное решение, которое дорого менять, оформляется записью в `docs/adr/`,
  а не правкой vision.md задним числом.
