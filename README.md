# OnBoard

Платформа интерактивного онбординга: встраиваемый JS-виджет, который показывает
пошаговые подсказки поверх интерфейса сайта клиента, и личный кабинет, где владелец
сайта собирает эти туры и смотрит аналитику прохождения — без привлечения разработчиков.

## Состав

| Каталог | Что это |
|---|---|
| `backend/` | FastAPI: публичное API для виджета, API панели, аналитика |
| `panel/` | React + TypeScript: личный кабинет владельца сайта |
| `widget/` | TypeScript без зависимостей: `loader.js`, `core.js`, `editor.js` |
| `testsite/` | стенд с враждебным CSS для проверки виджета |
| `e2e/` | сквозные сценарии на Playwright |
| `docs/` | документация проекта |

## С чего начать

```bash
make            # список доступных команд
make up         # поднять стек целиком
```

Репозиторий один; `backend/`, `panel/` и `widget/` публикуются наружу как зеркала
поддеревьев — см. [ADR-0007](docs/adr/0007-monorepo-with-subtree-publishing.md).

## Документация

| Файл | Отвечает на вопрос |
|---|---|
| [docs/idea.md](docs/idea.md) | цели и задачи заказчика, границы MVP |
| [docs/vision.md](docs/vision.md) | как устроена система: архитектура, модель данных, API |
| [docs/adr/](docs/adr/) | почему принято именно это решение |
| [docs/conventions.md](docs/conventions.md) | как писать код |
| [docs/workflow.md](docs/workflow.md) | как ведётся разработка |
| [docs/data-model.md](docs/data-model.md) | что храним и как устроена схема БД |
| [docs/screens.md](docs/screens.md) | экраны панели и их контракт с API |
| [docs/competitors.md](docs/competitors.md) | анализ аналогов и позиционирование |
| [docs/tasklist.md](docs/tasklist.md) | где мы сейчас и что следующее |
| [CLAUDE.md](CLAUDE.md) | правила проекта, подгружаются в каждую сессию |

## Статус

MVP в разработке. Текущий прогресс — в [docs/tasklist.md](docs/tasklist.md).
