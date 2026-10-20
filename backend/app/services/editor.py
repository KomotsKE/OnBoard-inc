"""Режим редактора: выдача сессии для выбора элементов на сайте клиента.

Состояния в базе у сессии нет — всё, что нужно, лежит в подписанном токене
(ADR-0004).
"""

from urllib.parse import urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ValidationError
from app.core.security import create_editor_token
from app.models import Project, Tour
from app.schemas.editor import Mode
from app.services.public_config import origin_allowed

PARAM = "onboard_edit"


def _origin(page_url: str) -> str:
    parts = urlsplit(page_url)
    return f"{parts.scheme}://{parts.netloc}".lower()


def _with_token(page_url: str, token: str) -> str:
    """Токен добавляется к адресу, остальное сохраняется.

    Query страницы может быть частью её состояния, а `#/маршрут` у сайтов на
    hash-роутинге — вообще адресом нужной страницы.
    """
    parts = urlsplit(page_url)
    query = f"{parts.query}&{PARAM}={token}" if parts.query else f"{PARAM}={token}"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


async def issue_session(
    session: AsyncSession,
    settings: Settings,
    tour: Tour,
    *,
    page_url: str,
    mode: Mode,
) -> tuple[str, int]:
    """Адрес страницы с токеном редактора и срок жизни токена в секундах."""
    project = await session.get(Project, tour.project_id)
    assert project is not None  # тур получен через проект владельца

    if not origin_allowed(project, _origin(page_url)):
        # Тот же список, что пускает виджет на сайт: редактор не может работать
        # там, где виджету запрещено загружаться (§8.1 docs/vision.md).
        raise ValidationError("домена этой страницы нет в списке разрешённых")

    token, expires_in = create_editor_token(settings, str(tour.id), mode)
    return _with_token(page_url, token), expires_in
