# Миграции

Схема базы меняется только через Alembic, и каждая миграция обязана откатываться
(инвариант №9). Поля и ограничения описаны в [data-model.md](../data-model.md) —
миграция повторяет их, а не придумывает заново.

## Команды

```bash
make migrate                      # alembic upgrade head
make revision m="добавить туры"   # новый пустой файл миграции
```

Применение происходит и само: сервис `migrate` в compose — одноразовый, а `api`
ждёт его успешного завершения (`service_completed_successfully`), поэтому API
не стартует на несуществующей схеме.

Откат и состояние:

```bash
docker compose run --rm --no-deps migrate alembic current       # текущая ревизия
docker compose run --rm --no-deps migrate alembic downgrade -1  # на шаг назад
docker compose run --rm --no-deps migrate alembic history       # история
```

## Как писать миграцию

1. Сначала правится [data-model.md](../data-model.md) — там живут поля, типы,
   ограничения и обоснования.
2. `make revision m="…"` создаёт файл в `backend/alembic/versions/`.
3. Пишутся **обе** стороны: `upgrade` и `downgrade`. `downgrade` с `pass` не
   принимается на ревью — без него нельзя вернуться, если миграция окажется неверной.
4. Проверка — полный цикл на чистой базе:

```bash
docker compose run --rm --no-deps migrate alembic downgrade base
make migrate
```

## Чего здесь нет и почему

**`--autogenerate` не используется по умолчанию.** Сейчас в метаданных нет моделей,
и автогенерация предложила бы удалить все существующие таблицы. Когда модели
появятся (T1.1 и далее), автогенерацию можно вызывать явно:

```bash
docker compose run --rm --no-deps migrate alembic revision --autogenerate -m "…"
```

и всё равно читать получившийся файл: `CHECK`-ограничения, частичные индексы и
`DEFERRABLE` автогенерация не видит.

**Новую модель нужно импортировать**, иначе автогенерация её не заметит: импорт
добавляется в `backend/app/alembic/env.py` или в `app/models/__init__.py`.

**Alembic синхронный**, хотя приложение асинхронное: миграции — отдельный
короткоживущий процесс, async в нём ничего не даёт ([ADR-0010](../adr/0010-async-backend.md)).

## Если что-то пошло не так

**`Target database is not up to date`** — есть неприменённые миграции: `make migrate`.

**Две головы (`Multiple heads`)** — появились параллельные ревизии. Смотрите
`alembic history`, объединяйте через `alembic merge`.

**Миграция упала на середине.** PostgreSQL выполняет DDL транзакционно, поэтому
частично применённой схемы не остаётся: исправьте файл и запустите снова.

**Нужна чистая база целиком:** `docker compose down -v` удаляет том `pgdata`
вместе со всеми локальными данными, затем `make up`.
