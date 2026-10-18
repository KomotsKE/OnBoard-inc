"""Публичный конфиг виджета (T2.1).

Самый горячий маршрут системы и единственный, который отвечает чужому домену,
поэтому проверяется и то, что он отдаёт, и то, что он отказывается отдавать.
"""

import uuid

import pytest

from app.main import app
from app.models import Project
from app.services.public_config import (
    WIDGET_SEEN_THROTTLE,
    normalise_url,
    touch_widget_seen,
)
from tests.factories import make_project, make_user

PASSWORD = "очень-длинный-пароль-владельца"
ORIGIN = "http://site.test"
CORE_FILE = "core.abc1234567.js"


class StubManifest:
    """Манифест без файловой системы: тесты не зависят от собранного виджета."""

    def __init__(self, core: str | None = CORE_FILE) -> None:
        self.core = core

    def core_file(self) -> str | None:
        return self.core


@pytest.fixture
def manifest(client) -> StubManifest:
    stub = StubManifest()
    app.state.widget_manifest = stub
    return stub


async def account(client, email: str = "owner@example.test") -> dict[str, str]:
    response = await client.post("/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def project_with_origin(client, auth, origins: list[str] | None = None) -> dict:
    created = await client.post("/v1/projects", json={"name": "Сайт"}, headers=auth)
    assert created.status_code == 201, created.text
    project = created.json()
    patched = await client.patch(
        f"/v1/projects/{project['id']}",
        json={"allowed_origins": [ORIGIN] if origins is None else origins},
        headers=auth,
    )
    assert patched.status_code == 200, patched.text
    return patched.json()


async def published_tour(client, auth, project_id: str, **body) -> dict:
    payload = {"name": "Знакомство"} | body
    tour = (
        await client.post(f"/v1/projects/{project_id}/tours", json=payload, headers=auth)
    ).json()
    created = await client.post(
        f"/v1/tours/{tour['id']}/steps",
        json={"selector": "#цель", "body": "Текст шага", "title": "Шаг"},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    published = await client.post(f"/v1/tours/{tour['id']}/publish", headers=auth)
    assert published.status_code == 200, published.text
    return published.json()


async def ask(client, key: str, url: str = "/", origin: str | None = ORIGIN, **headers):
    if origin is not None:
        headers["Origin"] = origin
    return await client.get("/v1/public/config", params={"key": key, "url": url}, headers=headers)


class TestNormaliseUrl:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("/pricing", "/pricing"),
            # Завершающий слэш — та же страница.
            ("/pricing/", "/pricing"),
            ("/", "/"),
            # Полный адрес тоже принимается: origin проверен заголовком.
            ("https://site.test/pricing?plan=pro", "/pricing?plan=pro"),
            # hash в SPA меняется произвольно и в сравнении не участвует.
            ("/pricing#section", "/pricing"),
            ("/pricing/?plan=pro", "/pricing?plan=pro"),
            ("", "/"),
        ],
    )
    def test_keeps_path_and_query(self, raw, expected):
        assert normalise_url(raw) == expected


class TestPayload:
    async def test_returns_core_url_theme_and_tour(self, client, manifest):
        auth = await account(client)
        project = await project_with_origin(client, auth)
        tour = await published_tour(
            client, auth, project["id"], url_match={"mode": "prefix", "value": "/reports"}
        )

        response = await ask(client, project["public_key"], "/reports")

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["core_url"].endswith(f"/{CORE_FILE}")
        assert body["project"]["theme"]["primary_color"] == "#2563EB"
        assert body["tour"]["id"] == tour["id"]
        assert [step["body"] for step in body["tour"]["steps"]] == ["Текст шага"]

    async def test_does_not_leak_project_fields(self, client, manifest):
        """Виджету достаточно темы: ни имени, ни ключа, ни списка доменов."""
        auth = await account(client)
        project = await project_with_origin(client, auth)

        body = (await ask(client, project["public_key"])).json()

        assert set(body["project"]) == {"theme"}

    async def test_page_without_tour_gets_null(self, client, manifest):
        """Загрузчик по `tour: null` решает не грузить ядро вовсе."""
        auth = await account(client)
        project = await project_with_origin(client, auth)
        await published_tour(
            client, auth, project["id"], url_match={"mode": "exact", "value": "/reports"}
        )

        body = (await ask(client, project["public_key"], "/settings")).json()

        assert body["tour"] is None
        assert body["core_url"].endswith(f"/{CORE_FILE}")

    async def test_draft_tour_is_not_served(self, client, manifest):
        auth = await account(client)
        project = await project_with_origin(client, auth)
        tour = await published_tour(client, auth, project["id"])
        await client.post(f"/v1/tours/{tour['id']}/unpublish", headers=auth)

        assert (await ask(client, project["public_key"])).json()["tour"] is None

    async def test_latest_published_tour_wins(self, client, manifest):
        """Подошли оба — показывается опубликованный позже."""
        auth = await account(client)
        project = await project_with_origin(client, auth)
        await published_tour(client, auth, project["id"], name="Старый")
        newer = await published_tour(client, auth, project["id"], name="Новый")

        body = (await ask(client, project["public_key"])).json()

        assert body["tour"]["id"] == newer["id"]
        assert body["tour"]["name"] == "Новый"


class TestMatching:
    @pytest.mark.parametrize(
        ("mode", "value", "url", "matches"),
        [
            ("exact", "/reports", "/reports", True),
            ("exact", "/reports", "/reports/", True),
            ("exact", "/reports", "/reports/weekly", False),
            # Регистр значим: по RFC 3986 путь регистрозависим.
            ("exact", "/reports", "/Reports", False),
            ("prefix", "/reports", "/reports/weekly", True),
            ("prefix", "/reports", "/billing", False),
            ("contains", "/reports", "/app/reports/weekly", True),
            ("contains", "report", "/billing", False),
            ("regex", r"^/reports/\d+$", "/reports/42", True),
            ("regex", r"^/reports/\d+$", "/reports/weekly", False),
            # Условие сравнивается с pathname + search.
            ("contains", "plan=pro", "/pricing?plan=pro", True),
        ],
    )
    async def test_url_match_modes(self, client, manifest, mode, value, url, matches):
        auth = await account(client)
        project = await project_with_origin(client, auth)
        await published_tour(client, auth, project["id"], url_match={"mode": mode, "value": value})

        body = (await ask(client, project["public_key"], url)).json()

        assert (body["tour"] is not None) is matches

    async def test_regex_rejected_by_database_is_not_accepted(self, client):
        """`(?P<name>…)` компилируется в Python и падает в PostgreSQL.

        Отбор тура идёт оператором `~` в SQL, поэтому выражение проверяется
        той же машинкой при сохранении: иначе один такой тур ронял бы конфиг
        всего проекта.
        """
        auth = await account(client)
        project = await project_with_origin(client, auth)

        response = await client.post(
            f"/v1/projects/{project['id']}/tours",
            json={"name": "Тур", "url_match": {"mode": "regex", "value": "(?P<page>/reports)"}},
            headers=auth,
        )

        assert response.status_code == 422, response.text
        assert response.json()["type"] == "/errors/validation"


class TestAccess:
    async def test_unknown_origin_is_refused(self, client, manifest):
        auth = await account(client)
        project = await project_with_origin(client, auth)

        response = await ask(client, project["public_key"], origin="http://evil.test")

        assert response.status_code == 403
        assert response.json()["type"] == "/errors/forbidden-origin"

    async def test_empty_origin_list_allows_nothing(self, client, manifest):
        """Fail closed: fail open дал бы чужому сайту работать по нашему ключу."""
        auth = await account(client)
        project = await project_with_origin(client, auth, origins=[])

        assert (await ask(client, project["public_key"])).status_code == 403

    async def test_request_without_origin_header_is_refused(self, client, manifest):
        auth = await account(client)
        project = await project_with_origin(client, auth)

        assert (await ask(client, project["public_key"], origin=None)).status_code == 403

    async def test_unknown_key_is_not_found(self, client, manifest):
        response = await ask(client, "pk_" + "0" * 32)

        assert response.status_code == 404
        assert response.json()["type"] == "/errors/not-found"

    @pytest.mark.parametrize("key", ["pk_короткий", "abc", "pk_" + "0" * 31, "pk_" + "G" * 32])
    async def test_malformed_key_never_reaches_the_database(self, client, manifest, key):
        response = await ask(client, key)

        assert response.status_code == 422

    async def test_rate_limit_answers_429_with_retry_after(self, client, manifest):
        auth = await account(client)
        project = await project_with_origin(client, auth)
        key = project["public_key"]
        limit, window = 120, 60
        # Бакет вычерпывается напрямую: 120 запросов по HTTP проверяли бы
        # не лимит, а скорость тестовой базы.
        for _ in range(limit):
            app.state.rate_limiter.allow(f"config:{key}:127.0.0.1", limit, window)

        response = await ask(client, key)

        assert response.status_code == 429
        assert response.json()["type"] == "/errors/rate-limited"
        assert int(response.headers["Retry-After"]) > 0

    async def test_unbuilt_widget_gives_503(self, client, manifest):
        """Нет манифеста — отказ развёртки, а не ошибка клиента."""
        auth = await account(client)
        project = await project_with_origin(client, auth)
        manifest.core = None

        response = await ask(client, project["public_key"])

        assert response.status_code == 503
        assert response.json()["type"] == "/errors/unavailable"


class TestCaching:
    async def test_cache_and_cors_headers(self, client, manifest):
        auth = await account(client)
        project = await project_with_origin(client, auth)

        response = await ask(client, project["public_key"])

        assert response.headers["Cache-Control"] == "public, max-age=60"
        # Эхо проверенного домена, а не `*`: ответ зависит от домена.
        assert response.headers["Access-Control-Allow-Origin"] == ORIGIN
        assert response.headers["Vary"] == "Origin"
        assert response.headers["ETag"].startswith('"')

    async def test_same_content_gives_304(self, client, manifest):
        auth = await account(client)
        project = await project_with_origin(client, auth)
        first = await ask(client, project["public_key"])

        second = await ask(
            client, project["public_key"], **{"If-None-Match": first.headers["ETag"]}
        )

        assert second.status_code == 304
        assert second.content == b""
        assert second.headers["ETag"] == first.headers["ETag"]

    async def test_etag_changes_when_theme_changes(self, client, manifest):
        auth = await account(client)
        project = await project_with_origin(client, auth)
        before = (await ask(client, project["public_key"])).headers["ETag"]

        theme = project["theme"] | {"primary_color": "#112233"}
        await client.patch(f"/v1/projects/{project['id']}", json={"theme": theme}, headers=auth)

        after = (await ask(client, project["public_key"])).headers["ETag"]
        assert after != before


class TestWidgetSeen:
    async def test_first_request_marks_project_connected(self, client, manifest, db):
        auth = await account(client)
        project = await project_with_origin(client, auth)
        stored = await db.get(Project, uuid.UUID(project["id"]))
        assert stored is not None and stored.widget_last_seen_at is None

        await ask(client, project["public_key"])

        await db.refresh(stored)
        assert stored.widget_last_seen_at is not None

    async def test_second_request_does_not_rewrite_the_mark(self, client, manifest, db):
        """Запись на каждый просмотр страницы клиента — лишняя нагрузка."""
        auth = await account(client)
        project = await project_with_origin(client, auth)
        await ask(client, project["public_key"])
        stored = await db.get(Project, uuid.UUID(project["id"]))
        await db.refresh(stored)
        first_seen = stored.widget_last_seen_at

        await ask(client, project["public_key"])

        await db.refresh(stored)
        assert stored.widget_last_seen_at == first_seen
        assert WIDGET_SEEN_THROTTLE.total_seconds() == 300


class TestWidgetSeenSignal:
    """Сигнал «виджет увиден впервые» — на уровне сервиса.

    Через HTTP его не видно: журнальная запись не попадает в ответ, а отметка
    в базе выглядит одинаково и после первого, и после второго запроса. Первая
    версия снимала признак после `UPDATE`, когда ORM уже синхронизировал
    атрибут загруженного объекта, и `widget.first_seen` не писался никогда.
    """

    async def test_reports_first_sighting_once(self, db):
        project = await make_project(db, user=await make_user(db))

        first = await touch_widget_seen(db, project)
        # Каждый запрос читает проект заново — тест делает то же самое. Иначе
        # он проверял бы не признак, а то, обновляет ли ORM атрибут в памяти
        # (а это зависит от сессии: в тестовой — нет, в рабочей — да).
        await db.refresh(project)
        second = await touch_widget_seen(db, project)

        assert (first, second) == (True, False)
