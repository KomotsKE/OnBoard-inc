# Поднять проект локально

Инструкция из задачи T0.2. Разворачивание на сервере — после приёмки MVP
(§15 [vision.md](../vision.md)).

## Что нужно на машине

| Инструмент | Версия | Проверка |
|---|---|---|
| Docker | 24+ | `docker --version` |
| Docker Compose | v2+ | `docker compose version` |
| Python | 3.12 | `python3 --version` |
| Node.js | 20 | `node --version` |
| Git | 2.30+ | `git --version` |

Python и Node нужны для инструментов разработки и тестов; сам стек работает
в контейнерах.

## Первый запуск

```bash
# 1. Окружение. Цель make env создаёт .env из шаблона, если его ещё нет.
make env

# 2. Секреты для локальной работы — значения из шаблона нерабочие.
python3 -c "import secrets; print('JWT_SECRET=' + secrets.token_urlsafe(48))"
python3 -c "import secrets; print('EDITOR_TOKEN_SECRET=' + secrets.token_urlsafe(48))"
# подставьте их в .env

# 3. Стек
make up
```

Готово, когда `make up` вывел контейнеры в состоянии `healthy` и адрес стенда.
Проверка руками:

```bash
curl -I localhost:8080                      # 200 OK — стенд отвечает
docker compose exec postgres pg_isready     # accepting connections
docker compose ps                           # без restarting
```

## Git-хуки (один раз)

Сообщения коммитов проверяются по Conventional Commits, файлы — набором хуков
(§11 [conventions.md](../conventions.md)). `pre-commit` нельзя поставить
в системный Python (PEP 668), поэтому он живёт в локальном `.venv`:

```bash
python3 -m venv .venv
.venv/bin/pip install pre-commit
make hooks
```

Проверить, что работает: `make commits` печатает историю с галочками.

## Повседневные команды

```bash
make up        # поднять стек
make down      # остановить (данные в томе pgdata остаются)
make logs      # логи всех сервисов
make test      # тесты (появятся с кодом, T0.5)
make lint      # линтеры
make           # список всех целей
```

## Что сейчас в стеке

| Сервис | Адрес | Появился в |
|---|---|---|
| `postgres` | `localhost:5432` | T0.2 |
| `testsite` | `localhost:8080` | T0.2 (заглушка; полный стенд — T0.8) |
| `api` | `localhost:8000` | T0.3 |
| `migrate` | одноразовый | T0.4 |
| `panel` | `localhost:5173` | T0.6 |

**Бэкенд запускается в один воркер uvicorn.** Это не упущение: rate limiter хранит
счётчики в памяти процесса, поэтому при нескольких воркерах лимиты считались бы
неверно. Переход на несколько воркеров — это вторая реализация интерфейса
`RateLimiter` на Redis (§4.5 [vision.md](../vision.md)).

## Если что-то не поднялось

**Порт занят** (`bind: address already in use`). Локальный PostgreSQL обычно держит
5432. Поменяйте `POSTGRES_PORT` или `TESTSITE_PORT` в `.env` и повторите `make up`.

**Контейнер postgres не становится healthy.** Посмотрите `docker compose logs postgres`.
Частая причина — том, созданный с другими параметрами локали: удалите его
(`docker compose down -v`, **это удалит локальные данные**) и поднимите заново.

**`make up` жалуется на переменные окружения.** Значит `.env` отсутствует или
неполон: сверьте его с `.env.example` — compose не подставляет значения по умолчанию
за вас.

**Приложение не стартует и пишет про отсутствующий секрет** (с T0.3). Так и задумано:
дефолтных секретов в коде нет, потому что дефолтный `JWT_SECRET` на сервере — это
токены, подписанные предсказуемым ключом (§13 [conventions.md](../conventions.md)).
Сгенерируйте значения из шага 2.

**Нужно начать с чистой базы.** `docker compose down -v` удаляет том `pgdata`
вместе со всеми локальными данными, затем `make up`.
