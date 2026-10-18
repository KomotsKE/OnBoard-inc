"""Туры: CRUD, публикация, условие показа, метрики списка и изоляция."""

import uuid

import pytest

from app.models import Project, Tour
from tests.factories import make_event, make_step

PASSWORD = "очень-длинный-пароль-владельца"


async def account(client, email: str) -> dict[str, str]:
    response = await client.post("/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def project_of(client, auth: dict[str, str], name: str = "Сайт") -> str:
    response = await client.post("/v1/projects", json={"name": name}, headers=auth)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def make_tour_via_api(client, auth, project_id: str, **body) -> dict:
    payload = {"name": "Знакомство"} | body
    response = await client.post(f"/v1/projects/{project_id}/tours", json=payload, headers=auth)
    assert response.status_code == 201, response.text
    return response.json()


class TestCreate:
    async def test_creates_draft_with_defaults(self, client):
        auth = await account(client, "owner@example.test")
        project_id = await project_of(client, auth)

        tour = await make_tour_via_api(client, auth, project_id)

        assert tour["status"] == "draft"
        assert tour["published_at"] is None
        assert tour["url_match"] == {"mode": "contains", "value": "/"}
        assert tour["show_once"] is True
        assert tour["steps"] == []

    async def test_accepts_url_match_and_show_once(self, client):
        auth = await account(client, "owner@example.test")
        project_id = await project_of(client, auth)

        tour = await make_tour_via_api(
            client,
            auth,
            project_id,
            url_match={"mode": "prefix", "value": "/dashboard"},
            show_once=False,
        )

        assert tour["url_match"] == {"mode": "prefix", "value": "/dashboard"}
        assert tour["show_once"] is False

    @pytest.mark.parametrize(
        "url_match",
        [
            {"mode": "regex", "value": "("},  # не компилируется
            {"mode": "regex", "value": "(a+)+" + "x" * 250},  # длиннее предела
            {"mode": "выдумка", "value": "/"},  # неизвестный режим
            {"mode": "contains", "value": ""},  # пустое значение
        ],
    )
    async def test_rejects_bad_url_match(self, client, url_match):
        auth = await account(client, "owner@example.test")
        project_id = await project_of(client, auth)

        response = await client.post(
            f"/v1/projects/{project_id}/tours",
            json={"name": "Тур", "url_match": url_match},
            headers=auth,
        )

        assert response.status_code == 422

    async def test_accepts_valid_regex(self, client):
        auth = await account(client, "owner@example.test")
        project_id = await project_of(client, auth)

        tour = await make_tour_via_api(
            client, auth, project_id, url_match={"mode": "regex", "value": r"^/orders/\d+$"}
        )

        assert tour["url_match"]["mode"] == "regex"


class TestPublish:
    async def test_rejects_publishing_without_steps(self, client):
        auth = await account(client, "owner@example.test")
        project_id = await project_of(client, auth)
        tour = await make_tour_via_api(client, auth, project_id)

        response = await client.post(f"/v1/tours/{tour['id']}/publish", headers=auth)

        assert response.status_code == 422
        assert response.json()["type"] == "/errors/validation"

    async def test_publishes_tour_with_steps(self, client, db):
        auth = await account(client, "owner@example.test")
        project_id = await project_of(client, auth)
        tour = await make_tour_via_api(client, auth, project_id)
        # Шаги добавляются в T1.5, поэтому здесь — фабрикой.
        await make_step(db, tour=await db.get(Tour, uuid.UUID(tour["id"])))

        response = await client.post(f"/v1/tours/{tour['id']}/publish", headers=auth)

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "published"
        assert body["published_at"] is not None

    async def test_unpublish_returns_to_draft_and_keeps_date(self, client, db):
        auth = await account(client, "owner@example.test")
        project_id = await project_of(client, auth)
        tour = await make_tour_via_api(client, auth, project_id)
        await make_step(db, tour=await db.get(Tour, uuid.UUID(tour["id"])))
        await client.post(f"/v1/tours/{tour['id']}/publish", headers=auth)

        response = await client.post(f"/v1/tours/{tour['id']}/unpublish", headers=auth)

        body = response.json()
        assert body["status"] == "draft"
        # Дата сохраняется: по ней видно, что тур когда-то публиковался.
        assert body["published_at"] is not None


class TestListMetrics:
    async def test_returns_envelope_with_metrics(self, client, db):
        auth = await account(client, "owner@example.test")
        project_id = await project_of(client, auth)
        tour = await make_tour_via_api(client, auth, project_id)

        body = (await client.get(f"/v1/projects/{project_id}/tours", headers=auth)).json()

        assert set(body) == {"items", "next_cursor"}
        item = body["items"][0]
        assert item["id"] == tour["id"]
        assert item["steps_count"] == 0
        assert item["runs_7d"] == 0
        assert item["completion_rate_7d"] == 0.0

    async def test_counts_runs_and_completion(self, client, db):
        auth = await account(client, "owner@example.test")
        project_id = await project_of(client, auth)
        api_tour = await make_tour_via_api(client, auth, project_id)

        project = await db.get(Project, uuid.UUID(project_id))
        tour = await db.get(Tour, uuid.UUID(api_tour["id"]))
        # Четыре запуска, два завершения — внутри окна.
        for index in range(4):
            run = uuid.uuid4()
            await make_event(db, project=project, tour=tour, type="tour_started", run_id=run)
            if index < 2:
                await make_event(db, project=project, tour=tour, type="tour_completed", run_id=run)
        # Запуск вне окна: в метрики не попадает.
        await make_event(db, project=project, tour=tour, type="tour_started", days_ago=10)

        item = (await client.get(f"/v1/projects/{project_id}/tours", headers=auth)).json()["items"][
            0
        ]

        assert item["runs_7d"] == 4
        assert item["completion_rate_7d"] == 0.5

    async def test_query_count_does_not_grow_with_tours(self, client, count_queries, db):
        """N+1 запрещён: число запросов — константа, а не функция от числа туров."""
        auth = await account(client, "owner@example.test")
        project_id = await project_of(client, auth)
        for index in range(3):
            await make_tour_via_api(client, auth, project_id, name=f"Тур {index}")

        count_queries["n"] = 0
        await client.get(f"/v1/projects/{project_id}/tours", headers=auth)
        with_three = count_queries["n"]

        for index in range(3, 9):
            await make_tour_via_api(client, auth, project_id, name=f"Тур {index}")

        count_queries["n"] = 0
        await client.get(f"/v1/projects/{project_id}/tours", headers=auth)
        with_nine = count_queries["n"]

        assert with_three == with_nine, f"{with_three} против {with_nine} запросов"


class TestTenantIsolation:
    @pytest.fixture
    async def foreign_tour(self, client):
        first = await account(client, "first@example.test")
        second = await account(client, "second@example.test")
        second_project = await project_of(client, second, name="Чужой")
        tour = await make_tour_via_api(client, second, second_project)
        return {"auth": first, "tour_id": tour["id"], "project_id": second_project}

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("get", "/v1/tours/{id}", None),
            ("patch", "/v1/tours/{id}", {"name": "Чужое"}),
            ("delete", "/v1/tours/{id}", None),
            ("post", "/v1/tours/{id}/publish", None),
            ("post", "/v1/tours/{id}/unpublish", None),
        ],
    )
    async def test_foreign_tour_is_not_found(self, client, foreign_tour, method, path, body):
        kwargs = {"headers": foreign_tour["auth"]} | ({"json": body} if body else {})

        response = await getattr(client, method)(path.format(id=foreign_tour["tour_id"]), **kwargs)

        assert response.status_code == 404, f"{method.upper()} {path}"
        assert response.json()["type"] == "/errors/not-found"

    async def test_foreign_project_tours_are_not_listed(self, client, foreign_tour):
        response = await client.get(
            f"/v1/projects/{foreign_tour['project_id']}/tours", headers=foreign_tour["auth"]
        )

        assert response.status_code == 404
