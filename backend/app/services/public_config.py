"""Конфиг виджета: проект по публичному ключу и подходящий тур для страницы.

Самый горячий путь системы: вызывается на каждой загрузке страницы у каждого
клиента. Поэтому здесь нет ни одного запроса, который можно не делать, а отбор
тура выполняется в SQL.
"""

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from sqlalchemy import ColumnElement, Text, case, func, literal, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import NotFoundError
from app.models import Project, Tour

# Статус «виджет подключён» обновляется не чаще раза в пять минут: иначе каждый
# просмотр страницы клиента порождал бы запись в БД (§4.5 docs/vision.md).
WIDGET_SEEN_THROTTLE = timedelta(minutes=5)


def normalise_url(url: str) -> str:
    """Адрес страницы, приведённый к виду, с которым сравнивается условие показа.

    Сравнивается `pathname + search`: `origin` уже проверен через
    `allowed_origins`, а `hash` в SPA меняется произвольно и ломал бы условие.
    Завершающий слэш убирается — `/pricing/` и `/pricing` одна страница. Регистр
    значим: по RFC 3986 путь регистрозависим (§6 docs/vision.md).
    """
    parts = urlsplit(url)
    path = parts.path or "/"
    if len(path) > 1:
        path = path.rstrip("/") or "/"
    return f"{path}?{parts.query}" if parts.query else path


def _matches(url: str) -> ColumnElement[bool]:
    """Условие показа как выражение SQL.

    Сравнение выполняется базой, а не Python, из-за режима `regex`: выражение
    пишет владелец сайта, и катастрофический бэктрекинг в `re` заблокировал бы
    event loop без всякого предела — таймаута у модуля нет. В PostgreSQL его
    обрывает `statement_timeout` публичных маршрутов, 2 с (§9.1 docs/vision.md).
    """
    target = literal(url, Text)
    return case(
        (Tour.url_match_mode == "exact", Tour.url_match_value == url),
        (Tour.url_match_mode == "prefix", func.starts_with(target, Tour.url_match_value)),
        (Tour.url_match_mode == "contains", func.strpos(target, Tour.url_match_value) > 0),
        (Tour.url_match_mode == "regex", target.regexp_match(Tour.url_match_value)),
        else_=literal(False),
    )


async def get_project(session: AsyncSession, public_key: str) -> Project:
    """Проект по публичному ключу. Неизвестный ключ — 404, как и чужой объект."""
    project = await session.scalar(select(Project).where(Project.public_key == public_key))
    if project is None:
        raise NotFoundError("проект не найден")
    return project


def origin_allowed(project: Project, origin: str) -> bool:
    """Fail closed: пустой список разрешённых доменов не разрешает ничего.

    Fail open был бы дырой — чужой сайт воспользовался бы публичным ключом,
    который виден в исходниках страницы клиента (§8.1 docs/vision.md).
    Запрос без заголовка `Origin` тоже отклоняется: браузер его всегда ставит,
    а запрос без него проверить нечем.
    """
    return bool(origin) and origin.strip().rstrip("/").lower() in project.allowed_origins


async def find_tour(session: AsyncSession, project_id: uuid.UUID, url: str) -> Tour | None:
    """Опубликованный тур для этой страницы или None.

    Условий может подойти несколько — побеждает опубликованный позже: это
    последнее по времени решение владельца. Порядок задан явно, иначе результат
    зависел бы от плана запроса и тур «мигал» бы между загрузками.
    """
    return await session.scalar(
        select(Tour)
        .options(selectinload(Tour.steps))
        .where(Tour.project_id == project_id, Tour.status == "published", _matches(url))
        .order_by(Tour.published_at.desc(), Tour.created_at.desc())
        .limit(1)
    )


async def touch_widget_seen(session: AsyncSession, project: Project) -> bool:
    """Отмечает, что виджет на проекте жив. True — увиден впервые.

    Условие стоит в самом `UPDATE`: читать отметку отдельным запросом ради
    решения «писать или нет» означало бы два round-trip вместо одного.
    """
    # Признак снимается до UPDATE: ORM синхронизирует атрибут загруженного
    # объекта с запросом, и после выполнения отметка уже стоит.
    first_time = project.widget_last_seen_at is None
    now = datetime.now(UTC)
    await session.execute(
        update(Project)
        .where(
            Project.id == project.id,
            or_(
                Project.widget_last_seen_at.is_(None),
                Project.widget_last_seen_at < now - WIDGET_SEEN_THROTTLE,
            ),
        )
        .values(widget_last_seen_at=now)
    )
    return first_time
