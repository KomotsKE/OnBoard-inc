"""Проекты: CRUD, лимиты, сниппет и изоляция арендаторов."""

import re

import pytest

from app.core.config import get_settings

PASSWORD = "очень-длинный-пароль-владельца"


async def account(client, email: str) -> dict[str, str]:
    """Регистрирует владельца и возвращает заголовок авторизации."""
    response = await client.post("/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def make_project(client, auth: dict[str, str], name: str = "Сайт") -> dict:
    response = await client.post("/v1/projects", json={"name": name}, headers=auth)
    assert response.status_code == 201, response.text
    return response.json()


class TestCreate:
    async def test_creates_with_key_and_full_theme(self, client):
        auth = await account(client, "owner@example.test")

        project = await make_project(client, auth, name="Отчётница")

        assert project["name"] == "Отчётница"
        assert re.fullmatch(r"pk_[0-9a-f]{32}", project["public_key"]), project["public_key"]
        # Тема пишется целиком: публичный конфиг отдаёт виджету готовые значения.
        assert project["theme"]["primary_color"] == "#2563EB"
        assert project["theme"]["skip_label"] == "Пропустить"
        assert project["allowed_origins"] == []
        assert project["widget_connected"] is False

    async def test_public_keys_are_unique(self, client):
        auth = await account(client, "owner@example.test")

        keys = {
            (await make_project(client, auth, name=f"Сайт {i}"))["public_key"] for i in range(5)
        }

        assert len(keys) == 5

    async def test_rejects_eleventh_project(self, client):
        auth = await account(client, "owner@example.test")
        for index in range(10):
            await make_project(client, auth, name=f"Сайт {index}")

        response = await client.post("/v1/projects", json={"name": "Одиннадцатый"}, headers=auth)

        assert response.status_code == 422
        assert response.headers["content-type"].startswith("application/problem+json")

    @pytest.mark.parametrize("name", ["", "x" * 201])
    async def test_rejects_bad_name(self, client, name):
        auth = await account(client, "owner@example.test")

        response = await client.post("/v1/projects", json={"name": name}, headers=auth)

        assert response.status_code == 422

    async def test_requires_authentication(self, client):
        response = await client.post("/v1/projects", json={"name": "Сайт"})

        assert response.status_code == 401


class TestList:
    async def test_returns_envelope(self, client):
        auth = await account(client, "owner@example.test")
        await make_project(client, auth)

        body = (await client.get("/v1/projects", headers=auth)).json()

        # Конверт отдаётся с первого дня, чтобы потом не менять контракт.
        assert set(body) == {"items", "next_cursor"}
        assert body["next_cursor"] is None
        assert len(body["items"]) == 1

    async def test_shows_only_own_projects(self, client):
        first = await account(client, "first@example.test")
        second = await account(client, "second@example.test")
        await make_project(client, first, name="Первый")
        await make_project(client, second, name="Второй")

        body = (await client.get("/v1/projects", headers=first)).json()

        assert [item["name"] for item in body["items"]] == ["Первый"]


class TestToursCount:
    """Список проектов показывает число туров (S4 docs/screens.md)."""

    async def test_counts_tours_of_each_project(self, client):
        auth = await account(client, "owner@example.test")
        first = await make_project(client, auth, "С турами")
        await make_project(client, auth, "Пустой")
        for name in ("Знакомство", "Вторая попытка"):
            await client.post(
                f"/v1/projects/{first['id']}/tours", json={"name": name}, headers=auth
            )

        items = (await client.get("/v1/projects", headers=auth)).json()["items"]

        counts = {item["name"]: item["tours_count"] for item in items}
        assert counts == {"С турами": 2, "Пустой": 0}

    async def test_query_count_does_not_grow_with_projects(self, client, count_queries):
        """Счёт идёт одним агрегатом, а не запросом на проект."""
        auth = await account(client, "owner@example.test")
        await make_project(client, auth, "Первый")

        count_queries["n"] = 0
        await client.get("/v1/projects", headers=auth)
        with_one = count_queries["n"]

        for index in range(4):
            await make_project(client, auth, f"Проект {index}")
        count_queries["n"] = 0
        await client.get("/v1/projects", headers=auth)

        assert count_queries["n"] == with_one


class TestUpdate:
    async def test_updates_name_origins_and_theme(self, client):
        auth = await account(client, "owner@example.test")
        project = await make_project(client, auth)

        response = await client.patch(
            f"/v1/projects/{project['id']}",
            json={
                "name": "Новое имя",
                "allowed_origins": ["https://example.com", "http://localhost:3000"],
                "theme": {"primary_color": "#0F766E", "next_label": "Вперёд"},
            },
            headers=auth,
        )

        body = response.json()
        assert body["name"] == "Новое имя"
        assert body["allowed_origins"] == ["https://example.com", "http://localhost:3000"]
        assert body["theme"]["primary_color"] == "#0F766E"
        assert body["theme"]["next_label"] == "Вперёд"
        # Не переданные поля темы остаются значениями по умолчанию.
        assert body["theme"]["skip_label"] == "Пропустить"

    @pytest.mark.parametrize(
        "origins",
        [
            ["example.com"],  # без схемы
            ["https://example.com/path"],  # с путём
            ["ftp://example.com"],  # чужая схема
            ["javascript:alert(1)"],
        ],
    )
    async def test_rejects_bad_origins(self, client, origins):
        auth = await account(client, "owner@example.test")
        project = await make_project(client, auth)

        response = await client.patch(
            f"/v1/projects/{project['id']}", json={"allowed_origins": origins}, headers=auth
        )

        assert response.status_code == 422

    async def test_rejects_bad_theme_values(self, client):
        auth = await account(client, "owner@example.test")
        project = await make_project(client, auth)

        response = await client.patch(
            f"/v1/projects/{project['id']}",
            json={"theme": {"primary_color": "синий", "backdrop_opacity": 3}},
            headers=auth,
        )

        assert response.status_code == 422


class TestDelete:
    async def test_deletes_own_project(self, client):
        auth = await account(client, "owner@example.test")
        project = await make_project(client, auth)

        assert (
            await client.delete(f"/v1/projects/{project['id']}", headers=auth)
        ).status_code == 204
        assert (await client.get(f"/v1/projects/{project['id']}", headers=auth)).status_code == 404


class TestSnippet:
    async def test_contains_key_and_addresses_from_settings(self, client):
        """Адреса берутся из настроек, а не из литералов в коде: при переезде
        на сервер меняется переменная окружения, а не выданные сниппеты."""
        settings = get_settings()
        auth = await account(client, "owner@example.test")
        project = await make_project(client, auth)

        snippet = (await client.get(f"/v1/projects/{project['id']}/snippet", headers=auth)).json()[
            "snippet"
        ]

        api = str(settings.public_api_url).rstrip("/")
        widget = str(settings.widget_base_url).rstrip("/")
        assert project["public_key"] in snippet
        assert f'data-api="{api}"' in snippet
        assert f'src="{widget}/loader.js"' in snippet
        assert "async" in snippet
        # Без завершающего слэша: иначе виджет соберёт адрес с двойным слэшем.
        assert "//loader.js" not in snippet.replace("http://", "")

    async def test_snippet_follows_key_of_the_requested_project(self, client):
        auth = await account(client, "owner@example.test")
        first = await make_project(client, auth, name="Первый")
        second = await make_project(client, auth, name="Второй")

        snippet = (await client.get(f"/v1/projects/{second['id']}/snippet", headers=auth)).json()[
            "snippet"
        ]

        assert second["public_key"] in snippet
        assert first["public_key"] not in snippet


class TestTenantIsolation:
    """Матрица доступа: два владельца, по проекту у каждого, все приватные
    маршруты проекта. Чужой объект обязан давать 404, а не 403 — иначе ответ
    подтверждает существование объекта (ADR-0006).
    """

    @pytest.fixture
    async def two_owners(self, client):
        first = await account(client, "first@example.test")
        second = await account(client, "second@example.test")
        return {
            "first": {"auth": first, "project": await make_project(client, first, name="Первый")},
            "second": {
                "auth": second,
                "project": await make_project(client, second, name="Второй"),
            },
        }

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("get", "/v1/projects/{id}", None),
            ("patch", "/v1/projects/{id}", {"name": "Чужое"}),
            ("delete", "/v1/projects/{id}", None),
            ("get", "/v1/projects/{id}/snippet", None),
        ],
    )
    async def test_foreign_project_is_not_found(self, client, two_owners, method, path, body):
        foreign_id = two_owners["second"]["project"]["id"]
        auth = two_owners["first"]["auth"]

        kwargs = {"headers": auth} | ({"json": body} if body else {})
        response = await getattr(client, method)(path.format(id=foreign_id), **kwargs)

        assert response.status_code == 404, f"{method.upper()} {path} вернул {response.status_code}"
        assert response.json()["type"] == "/errors/not-found"

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", "/v1/projects/{id}"),
            ("patch", "/v1/projects/{id}"),
            ("delete", "/v1/projects/{id}"),
            ("get", "/v1/projects/{id}/snippet"),
        ],
    )
    async def test_own_project_is_accessible(self, client, two_owners, method, path):
        own_id = two_owners["first"]["project"]["id"]
        auth = two_owners["first"]["auth"]

        kwargs = {"headers": auth} | ({"json": {"name": "Своё"}} if method == "patch" else {})
        response = await getattr(client, method)(path.format(id=own_id), **kwargs)

        assert response.status_code in (200, 204)

    async def test_nonexistent_project_looks_the_same_as_foreign(self, client, two_owners):
        auth = two_owners["first"]["auth"]
        foreign = two_owners["second"]["project"]["id"]

        missing = await client.get(
            "/v1/projects/00000000-0000-0000-0000-000000000000", headers=auth
        )
        alien = await client.get(f"/v1/projects/{foreign}", headers=auth)

        assert missing.status_code == alien.status_code == 404
        assert missing.json() == alien.json()
