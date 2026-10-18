# Модель данных: что храним и как это устроено в БД

Версия: 1.0 · Дата: 2026-10-13

Физическая схема, из которой пишутся миграции. Логическая модель и архитектурные
обоснования — [vision.md §6](vision.md); здесь — таблицы, типы, ограничения, индексы,
объёмы и жизненный цикл. Field-level детали живут только здесь, чтобы не разойтись.

---

## 1. Что мы храним и зачем

Четыре категории с разной чувствительностью, объёмом и сроком жизни. Смешивать их в
одном подходе нельзя: у них разные требования.

| Категория | Что это | Персональные данные | Объём | Срок жизни |
|---|---|---|---|---|
| **Аккаунт** | email и хэш пароля владельца сайта | да, PII владельца (не конечных пользователей) | десятки строк | до удаления аккаунта |
| **Сессии** | хэши refresh-токенов, цепочки ротации | нет | единицы на пользователя | 30 дней или до выхода |
| **Конфигурация** | проекты, ключи, темы, туры, шаги | нет | сотни строк | до удаления владельцем |
| **Телеметрия** | события прохождения туров | нет, обезличено по дизайну | миллионы строк | 180 дней |

Ключевое следствие: **единственные персональные данные в системе — email владельца
сайта, нашего клиента.** О конечных пользователях его сайта мы не храним ничего, что
позволило бы их опознать. Это не побочный эффект, а требование из §3.4 idea.md: конечный
пользователь не давал нам согласия и не может его отозвать.

---

## 2. Что мы сознательно не храним

| Не храним | Почему |
|---|---|
| IP-адрес конечного пользователя | персональные данные по 152-ФЗ и GDPR; для нашей аналитики бесполезен |
| Сырой User-Agent | это отпечаток браузера. Мы его **не разбираем и не получаем**: `device` виджет определяет по возможностям браузера (§7.1 vision.md), разбивки по браузерам в MVP нет |
| Email, имя, идентификатор конечного пользователя | нет вызова `identify`, как у аналогов (§6 competitors.md) — и это осознанно |
| Query-строку и фрагмент URL страницы | в параметрах регулярно оказываются токены, email и идентификаторы заказов. Храним **только path**, обрезанный до 200 символов |
| Содержимое DOM сайта клиента, текст элементов, скриншоты | это данные его бизнеса; из страницы мы сохраняем только CSS-селектор, который сгенерировал или ввёл сам владелец |
| Cookie на сайте клиента | ни одной — тема согласия на обработку не возникает |
| Стектрейсы ошибок виджета | в них попадают фрагменты кода чужого сайта; в `widget_error` уходит только наш код ошибки |

**Задел на будущее, который потребует отдельного решения.** Самовосстановление
селекторов (§12 vision.md, фаза 3) по своей природе требует хранить контекст элемента —
его текст, роль, окружение. Это уже данные со страницы клиента, то есть смена категории
хранимого. Когда дойдём — это новый ADR и отдельное согласие клиента, а не тихое
расширение колонки.

---

## 3. Схема

Диалект — PostgreSQL 16. `gen_random_uuid()` входит в ядро, расширения не требуются.

Схема ниже **проверена прогоном в PostgreSQL 16.15**: применяется без ошибок, все
`CHECK` отбивают заявленные случаи, каскады удаляют цепочку целиком, reorder шагов
проходит, повторная вставка события не создаёт дубля. Протокол проверки — §11.

### 3.1 Миграция 001: аккаунты, сессии, проекты (задача T0.4)

```sql
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL,
    password_hash text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_lower CHECK (email = lower(email)),
    CONSTRAINT users_email_len   CHECK (char_length(email) BETWEEN 3 AND 254)
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- Ротация refresh-токенов из ADR-0008: без состояния на сервере
-- обнаружить повторное использование украденного токена невозможно.
CREATE TABLE refresh_sessions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    family_id  uuid        NOT NULL,          -- цепочка ротаций одного входа
    token_hash bytea       NOT NULL,          -- sha256 от токена, не сам токен
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,                   -- когда токен был обменян
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refresh_sessions_token_key  ON refresh_sessions (token_hash);
CREATE INDEX        refresh_sessions_family_idx ON refresh_sessions (family_id);
CREATE INDEX        refresh_sessions_user_idx   ON refresh_sessions (user_id);

CREATE TABLE projects (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name                text        NOT NULL,
    public_key          text        NOT NULL,
    allowed_origins     text[]      NOT NULL DEFAULT '{}',
    theme               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    widget_last_seen_at timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT projects_name_len    CHECK (char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT projects_key_fmt     CHECK (public_key ~ '^pk_[0-9a-f]{32}$'),
    CONSTRAINT projects_origins_cnt CHECK (cardinality(allowed_origins) <= 20)
);
CREATE UNIQUE INDEX projects_public_key_key ON projects (public_key);
CREATE INDEX        projects_user_idx       ON projects (user_id);
```

**Как работает защита refresh-токена.** При обмене ищем строку по `token_hash`.
Если `used_at` уже заполнен — токен использован второй раз, то есть украден: гасим всю
`family_id` одним `UPDATE` и отвечаем 401. Если всё в порядке — ставим `used_at`,
создаём новую строку той же семьи и отдаём новый токен. Храним хэш, а не токен: утечка
дампа БД не даёт войти в чужой аккаунт.

### 3.2 Миграция 002: туры и шаги (задачи T1.4, T1.5)

```sql
CREATE TABLE tours (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name            text        NOT NULL,
    status          text        NOT NULL DEFAULT 'draft',
    url_match_mode  text        NOT NULL DEFAULT 'contains',
    url_match_value text        NOT NULL DEFAULT '/',
    show_once       boolean     NOT NULL DEFAULT true,
    published_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tours_status_chk    CHECK (status IN ('draft', 'published', 'archived')),
    CONSTRAINT tours_match_mode    CHECK (url_match_mode IN ('exact', 'contains', 'prefix', 'regex')),
    CONSTRAINT tours_match_val_len CHECK (char_length(url_match_value) BETWEEN 1 AND 500),
    CONSTRAINT tours_published_ts  CHECK (status <> 'published' OR published_at IS NOT NULL),
    CONSTRAINT tours_name_len      CHECK (char_length(name) BETWEEN 1 AND 200)
);
CREATE INDEX tours_project_status_idx ON tours (project_id, status);

CREATE TABLE steps (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tour_id             uuid        NOT NULL REFERENCES tours (id) ON DELETE CASCADE,
    position            smallint    NOT NULL,
    selector            text        NOT NULL,
    selector_candidates text[]      NOT NULL DEFAULT '{}',
    title               text        NOT NULL DEFAULT '',
    body                text        NOT NULL,
    placement           text        NOT NULL DEFAULT 'auto',
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT steps_position_rng  CHECK (position BETWEEN 0 AND 199),
    CONSTRAINT steps_selector_len  CHECK (char_length(selector) BETWEEN 1 AND 500),
    CONSTRAINT steps_title_len     CHECK (char_length(title) <= 200),
    CONSTRAINT steps_body_len      CHECK (char_length(body) BETWEEN 1 AND 2000),
    CONSTRAINT steps_placement_chk CHECK (placement IN ('auto', 'top', 'bottom', 'left', 'right')),
    CONSTRAINT steps_cand_cnt      CHECK (cardinality(selector_candidates) <= 5),
    CONSTRAINT steps_tour_position_key UNIQUE (tour_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
```

**`DEFERRABLE` на уникальности — то, что делает drag-and-drop возможным.** Переставляя
шаг с позиции 3 на позицию 0, промежуточное состояние неизбежно содержит две одинаковые
позиции. Разница проверена на PostgreSQL 16.15:

- обычный `UNIQUE (tour_id, position)` проверяет каждую строку сразу и роняет такой
  `UPDATE` посреди выполнения: `duplicate key value violates unique constraint`;
- тот же `UNIQUE`, объявленный `DEFERRABLE INITIALLY IMMEDIATE`, проверяется **в конце
  оператора** — и перестановка проходит одним `UPDATE ... CASE`, без трюков с
  временными отрицательными позициями.

`SET CONSTRAINTS ... DEFERRED` нужен только тогда, когда перестановка разбита на
несколько операторов внутри одной транзакции. Наш reorder — один оператор, поэтому
достаточно самого объявления `DEFERRABLE` (задача T1.5).

**`url_match` разложен на две колонки**, а не хранится как JSONB: по нему идёт отбор
тура в самом горячем запросе `/public/config`. Условие в JSONB пришлось бы либо
вычислять в Python после выборки всех туров проекта, либо строить индекс по выражению.

### 3.3 Миграция 003: события (задача T4.1)

```sql
CREATE TABLE events (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id      uuid        NOT NULL,                 -- генерирует клиент
    project_id    uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    tour_id       uuid                 REFERENCES tours (id)    ON DELETE CASCADE,
    step_id       uuid                 REFERENCES steps (id)    ON DELETE SET NULL,
    step_position smallint,                                      -- денормализация, см. ниже
    run_id        uuid,
    visitor_id    uuid,
    type          text        NOT NULL,
    url_path      text,                                           -- только path, без query
    device        text,
    error_code    text,                                           -- только для widget_error
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT events_type_chk CHECK (type IN (
        'tour_started', 'step_viewed', 'step_back', 'tour_skipped',
        'tour_completed', 'step_target_missing', 'widget_error', 'widget_ping')),
    CONSTRAINT events_device_chk   CHECK (device IS NULL OR device IN ('desktop', 'mobile', 'tablet')),
    CONSTRAINT events_url_len      CHECK (url_path IS NULL OR char_length(url_path) <= 200),
    CONSTRAINT events_pos_rng      CHECK (step_position IS NULL OR step_position BETWEEN 0 AND 199)
);
CREATE UNIQUE INDEX events_event_id_key       ON events (event_id);
CREATE INDEX        events_tour_created_idx   ON events (tour_id, created_at);
CREATE INDEX        events_project_created_idx ON events (project_id, created_at);
```

**Почему `step_position` дублирует данные из `steps`.** Владелец удаляет шаг — `step_id`
в событиях становится `NULL` (`ON DELETE SET NULL`), но воронка за прошлый период должна
остаться считаемой. Позиция, записанная в момент события, — исторический факт, который
не должен меняться вслед за правкой тура. Это осознанная денормализация, а не упущение.

**`type` — `text` с `CHECK`, не `enum`.** Добавление типа события — одна строка в
миграции в обоих вариантах, но `enum` в PostgreSQL нельзя уменьшить, а порядок значений
влияет на сортировку. Отсюда же правило: типы событий только добавляются и никогда не
переименовываются — на чужих сайтах неделями живут старые версии виджета
([ADR-0009](adr/0009-widget-cache-and-versioning.md)).

---

## 4. Решения по ключам и типам

| Решение | Почему |
|---|---|
| `uuid` как первичный ключ для `users`, `projects`, `tours`, `steps` | эти идентификаторы видны в URL панели и в API. Последовательный `bigint` раскрывал бы число клиентов и позволял перебирать объекты (ответ 404 по [ADR-0006](adr/0006-tenant-isolation-404.md) это смягчает, но не отменяет) |
| `bigint identity` для `events` | случайные UUID в первичном ключе таблицы с миллионами вставок разносят B-дерево и бьют по скорости вставки — а вставка здесь горячий путь. Внешнего доступа по `id` события нет |
| `event_id uuid` отдельно от `id` | идемпотентность: генерирует клиент, уникальный индекс гасит дубли `sendBeacon` (инвариант №8) |
| `timestamptz` везде, UTC | §7.2 vision.md: периоды — скользящие окна в UTC. `timestamp` без зоны породил бы расхождения при переносе на сервер |
| `theme jsonb` | набор настроек темы будет меняться, запросов по отдельным полям нет. Валидация — в Pydantic, не в БД |
| `allowed_origins text[]` | список коротких строк, читается целиком вместе с проектом; отдельная таблица на 1–3 строки ничего не даёт |
| `bytea` для `token_hash` | это бинарный sha256, а не текст |
| `visitor_id uuid` | приходит от клиента и валидируется как UUID — иначе в колонку приедет что угодно |

---

## 5. Лимиты: где проверяется что

Правило разделения: **в БД — то, что не изменится никогда; в Pydantic — продуктовые
лимиты.** Иначе каждое продуктовое решение превращается в миграцию.

| Лимит | Значение | Где проверяется |
|---|---|---|
| проектов на пользователя | 10 | Pydantic + запрос `COUNT` в сервисе |
| туров на проект | 50 | сервис |
| шагов в туре | 20 | сервис (в БД `position` ограничен 0–199 как защита от абсурда) |
| заголовок шага | 80 символов | Pydantic (в БД `<= 200`) |
| текст шага | 500 символов | Pydantic (в БД `<= 2000`) |
| селектор | 500 символов | Pydantic и БД — здесь значения совпадают, селектор длиннее 500 символов бессмыслен |
| событий в батче | 50 | Pydantic |
| формат `public_key` | `pk_` + 32 hex | БД (`CHECK`) — формат не изменится |
| перечисления (`status`, `placement`, `type`, `device`) | — | БД (`CHECK`) |
| email в нижнем регистре | — | БД (`CHECK`) + нормализация в сервисе |
| длина пароля | от 15 до 128 символов | Pydantic |
| состав пароля | правил нет | — |
| скомпрометированные пароли | блок-лист top-10000 | сервис при регистрации и смене |

### 5.1 Политика пароля

Сделано по [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html):

- **длина от 15 символов**, принимаем до 128 — чтобы парольные фразы проходили целиком;
- **никаких требований к составу.** Обязательные «заглавная + цифра + символ» NIST
  прямо запрещает: они не добавляют стойкости и выгоняют людей в `Password1!`;
- **проверка по списку худших 10 000 паролей** — это даёт больше, чем любые правила
  состава;
- **принудительной смены по расписанию нет**, сброс только при признаках компрометации;
- разрешены все символы, включая пробелы и юникод; значение не обрезается.

**Почему 15, а не 8.** NIST допускает 8 как абсолютный минимум и рекомендует 15 там,
где пароль — единственный фактор; второго фактора в MVP нет, поэтому берём 15.

Сначала здесь было 12 с обоснованием «разницу закроет блок-лист». Обоснование
оказалось неверным, и это видно по самим данным: в списке
[top-10000 из SecLists](https://github.com/danielmiessler/SecLists) ровно **10 записей
длиной 12 символов и больше**, и при минимуме 15 — **одна из 10 001**
(`films+pic+galeries`). То есть блок-лист при такой длине отсекает один пароль из
десяти тысяч, а работает именно длина.

Блок-лист оставлен по двум причинам: проверка по списку известных утёкших паролей —
требование NIST само по себе, и он станет значимым, если появится второй фактор и
минимум можно будет снизить до 8. Файл лежит в `backend/app/data/weak_passwords.txt`,
читается один раз на процесс, сравнение идёт в нижнем регистре.

### 5.2 Значения `theme` по умолчанию

```json
{
  "primary_color":    "#2563EB",
  "text_color":       "#0F172A",
  "backdrop_opacity": 0.55,
  "border_radius":    "8px",
  "font_family":      "system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
  "next_label":       "Далее",
  "skip_label":       "Пропустить",
  "done_label":       "Готово"
}
```

Контраст проверен расчётом по WCAG 2.2: белый текст на `#2563EB` — **5,17** (норма 4,5),
текст `#0F172A` на белом — **17,85**. Шрифт системный, чтобы не тянуть веб-шрифт на
чужой сайт. Обводка подсветки — белая снаружи и брендовая внутри: один брендовый цвет
на затемнении даёт контраст 1,09, то есть невидим (§4.4 vision.md).

Email приводим к нижнему регистру при записи: иначе `Ivan@mail.ru` и `ivan@mail.ru`
дадут два аккаунта. `CHECK (email = lower(email))` гарантирует, что ни один путь
записи не обойдёт нормализацию.

---

## 6. Индексы и зачем каждый нужен

| Индекс | Обслуживает запрос |
|---|---|
| `users_email_key` (unique) | вход по email |
| `projects_public_key_key` (unique) | `/public/config` — самый горячий путь системы |
| `projects_user_idx` | список проектов владельца |
| `tours_project_status_idx` | отбор опубликованных туров проекта при сборке конфига |
| `steps_tour_position_key` (unique, deferrable) | порядок шагов и корректность reorder |
| `events_event_id_key` (unique) | идемпотентность ingest |
| `events_tour_created_idx` | воронка и тоталы по туру за период |
| `events_project_created_idx` | сводка по проекту и будущая чистка по retention |
| `refresh_sessions_token_key` (unique) | обмен refresh-токена |
| `refresh_sessions_family_idx` | погашение всей цепочки при обнаружении кражи |

**Индекса по `run_id` нет сознательно**, хотя в §6 vision.md он упоминался. Аналитика
группирует по `run_id` внутри уже отобранного окна `(tour_id, created_at)` — для этого
индекс не нужен, а каждый лишний индекс замедляет вставку. Вставка событий — горячий
путь, аналитика — редкий запрос одного человека.

---

## 7. Оценка объёмов

Расчёт на один активный проект, тур из 4 шагов:

```
События на один проход:  1 tour_started + 4 step_viewed + 1 завершение/скип ≈ 6
1 000 запусков в сутки:  6 000 строк в сутки
                         180 000 строк в месяц
Размер строки:           ≈ 170 байт данных + ≈ 90 байт индексов ≈ 260 байт
Объём:                   ≈ 47 МБ в месяц на такой проект
10 таких проектов:       ≈ 470 МБ в месяц
Retention 180 дней:      ≈ 2,8 ГБ — установившийся размер таблицы
```

Вывод: до нескольких гигабайт PostgreSQL с этими индексами работает без ухищрений.
Партиционирование, предагрегаты и колоночное хранилище — за порогом MVP
([ADR-0005](adr/0005-postgres-for-events.md), §11 vision.md). Для разработки и демо
масштаб другой: `make seed` (T0.11) создаёт десятки строк, а приёмочный прогон из
10 сессий — около 60.

Конфигурация занимает единицы мегабайт при любом реалистичном числе клиентов и в
расчётах не участвует.

---

## 8. Жизненный цикл данных

| Событие | Что происходит |
|---|---|
| Выход из аккаунта | строка `refresh_sessions` помечается `revoked_at`; cookie гасится |
| Повторное использование refresh-токена | вся `family_id` помечается отозванной, пользователь разлогинивается везде |
| Истечение refresh-токена | строка остаётся до чистки; при обмене проверяется `expires_at` |
| Удаление шага | `steps` строка удаляется, `events.step_id` → `NULL`, `step_position` сохраняется |
| Удаление тура | каскадно удаляются шаги и события тура |
| Удаление проекта | каскадно удаляются туры, шаги и все события проекта |
| Удаление аккаунта | каскадно удаляется всё перечисленное выше |
| Событие старше 180 дней | политика на удаление; механизм — позже, cron-контейнер |
| Токен редактора | состояния в БД нет, подписан и истекает сам (§9) |

---

## 9. Токены редактора: без таблицы

Токен editor-mode — подписанный HMAC-токен с `tour_id`, `project_id` и временем
истечения внутри; в БД он не хранится. Два следствия, которые надо знать:

- **токен не одноразовый.** Одноразовый здесь физически не работал бы: владелец ходит
  по своим страницам и перезагружает их, выбирая элементы для разных шагов, то есть
  предъявляет токен многократно. В [ADR-0004](adr/0004-editor-mode-over-http.md)
  формулировка уточнена;
- **отозвать его досрочно нельзя.** Он живёт 15 минут и даёт права только на чтение
  одного тура и правку его шагов. Таблица ради возможности отзыва в MVP не окупается.

---

## 10. Что отложено

- партиционирование `events` по месяцам — когда таблица превысит несколько десятков
  гигабайт;
- предагрегаты и материализованные представления для аналитики — когда
  `GET /tours/{id}/analytics` выйдет за 500 мс (§11 vision.md);
- чистка по retention — cron-контейнер, когда появятся данные старше 180 дней;
- `citext` для email — обошлись `lower()` плюс `CHECK`, расширение не нужно;
- хранение контекста элемента для самовосстановления селекторов — отдельный ADR (§2);
- оптимистичная блокировка при конкурентной правке тура из двух вкладок: в MVP
  последняя запись побеждает. У проекта один владелец (роли вне границ MVP), риск мал;
  при появлении командной работы понадобится `If-Match` по `updated_at`.

---

## 11. Протокол проверки схемы

Выполнено 2026-10-13 на `postgres:16-alpine` (PostgreSQL 16.15): схема из §3 применена
в чистую базу, затем прогнаны проверки. Перепроверено после отказа от колонки
`browser` — схема применяется, состав колонок `events` соответствует §3.3. Повторяется поднятием контейнера и прогоном
того же набора.

| Проверка | Ожидание | Результат |
|---|---|---|
| Применение всех трёх миграций | без ошибок | ✓ |
| `email` в верхнем регистре | отказ по `users_email_lower` | ✓ отказ |
| `public_key` неверного формата | отказ по `projects_key_fmt` | ✓ отказ |
| `status='published'` без `published_at` | отказ по `tours_published_ts` | ✓ отказ |
| Неизвестный тип события | отказ по `events_type_chk` | ✓ отказ |
| Reorder шагов одним `UPDATE` | проходит (constraint `DEFERRABLE`) | ✓ порядок 0–3 корректен |
| Тот же reorder при обычном `UNIQUE` | падает | ✓ падает — подтверждает необходимость `DEFERRABLE` |
| Повторная вставка одного `event_id` | одна строка (`ON CONFLICT DO NOTHING`) | ✓ одна строка |
| Удаление шага | событие остаётся, `step_id → NULL`, `step_position` сохранён | ✓ |
| Удаление пользователя | каскадом уходят проекты, туры, шаги, события, сессии | ✓ всё по нулям |

Что этим **не** проверено: производительность на реальных объёмах, поведение индексов
под нагрузкой, конкурентный reorder из двух транзакций (тест на блокировки — в T1.5).
