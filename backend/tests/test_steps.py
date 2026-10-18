"""Шаги: CRUD, перестановка одним оператором, снятие тура с публикации."""

import asyncio
import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import Step, Tour
from app.services import steps as steps_service

PASSWORD = "очень-длинный-пароль-владельца"


async def account(client, email: str) -> dict[str, str]:
    response = await client.post("/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def tour_with_steps(client, auth, count: int = 0) -> tuple[str, list[str]]:
    project_id = (await client.post("/v1/projects", json={"name": "Сайт"}, headers=auth)).json()[
        "id"
    ]
    tour_id = (
        await client.post(
            f"/v1/projects/{project_id}/tours", json={"name": "Знакомство"}, headers=auth
        )
    ).json()["id"]

    step_ids = []
    for index in range(count):
        response = await client.post(
            f"/v1/tours/{tour_id}/steps",
            json={"selector": f"#шаг-{index}", "body": f"Текст {index}"},
            headers=auth,
        )
        assert response.status_code == 201, response.text
        step_ids.append(response.json()["id"])
    return tour_id, step_ids


class TestCreate:
    async def test_appends_to_the_end(self, client):
        auth = await account(client, "owner@example.test")
        tour_id, _ = await tour_with_steps(client, auth, count=3)

        tour = (await client.get(f"/v1/tours/{tour_id}", headers=auth)).json()

        assert [step["position"] for step in tour["steps"]] == [0, 1, 2]
        assert [step["selector"] for step in tour["steps"]] == ["#шаг-0", "#шаг-1", "#шаг-2"]

    async def test_defaults_title_and_placement(self, client):
        auth = await account(client, "owner@example.test")
        tour_id, _ = await tour_with_steps(client, auth)

        step = (
            await client.post(
                f"/v1/tours/{tour_id}/steps",
                json={"selector": "#цель", "body": "Текст"},
                headers=auth,
            )
        ).json()

        assert step["title"] == ""
        assert step["placement"] == "auto"

    async def test_rejects_twenty_first_step(self, client):
        auth = await account(client, "owner@example.test")
        tour_id, _ = await tour_with_steps(client, auth, count=20)

        response = await client.post(
            f"/v1/tours/{tour_id}/steps",
            json={"selector": "#лишний", "body": "Текст"},
            headers=auth,
        )

        assert response.status_code == 422

    @pytest.mark.parametrize(
        "body",
        [
            {"selector": "", "body": "Текст"},
            {"selector": "#цель", "body": ""},
            {"selector": "#цель", "body": "x" * 501},
            {"selector": "#цель", "body": "Текст", "title": "x" * 81},
            {"selector": "#цель", "body": "Текст", "placement": "сбоку"},
        ],
    )
    async def test_rejects_bad_payload(self, client, body):
        auth = await account(client, "owner@example.test")
        tour_id, _ = await tour_with_steps(client, auth)

        response = await client.post(f"/v1/tours/{tour_id}/steps", json=body, headers=auth)

        assert response.status_code == 422


class TestUpdate:
    async def test_updates_fields(self, client):
        auth = await account(client, "owner@example.test")
        tour_id, step_ids = await tour_with_steps(client, auth, count=1)

        response = await client.patch(
            f"/v1/steps/{step_ids[0]}",
            json={"title": "Фильтры переехали", "placement": "bottom"},
            headers=auth,
        )

        body = response.json()
        assert body["title"] == "Фильтры переехали"
        assert body["placement"] == "bottom"
        # Не переданные поля не меняются.
        assert body["selector"] == "#шаг-0"


class TestReorder:
    async def test_moves_step_from_last_to_first(self, client):
        auth = await account(client, "owner@example.test")
        tour_id, step_ids = await tour_with_steps(client, auth, count=4)
        new_order = [step_ids[3], *step_ids[:3]]

        response = await client.put(
            f"/v1/tours/{tour_id}/steps/order", json={"step_ids": new_order}, headers=auth
        )

        assert response.status_code == 200
        body = response.json()
        assert [step["id"] for step in body] == new_order
        # Позиции без дыр и дублей.
        assert [step["position"] for step in body] == [0, 1, 2, 3]

    async def test_reorder_is_one_statement(self, client, count_queries):
        """Перестановка проходит одним UPDATE — на этом и держится DEFERRABLE.

        Считаем запросы: их число не должно расти с числом шагов.
        """
        auth = await account(client, "owner@example.test")
        tour_id, step_ids = await tour_with_steps(client, auth, count=4)

        count_queries["n"] = 0
        await client.put(
            f"/v1/tours/{tour_id}/steps/order",
            json={"step_ids": list(reversed(step_ids))},
            headers=auth,
        )
        with_four = count_queries["n"]

        tour_id, step_ids = await tour_with_steps(client, auth, count=10)
        count_queries["n"] = 0
        await client.put(
            f"/v1/tours/{tour_id}/steps/order",
            json={"step_ids": list(reversed(step_ids))},
            headers=auth,
        )
        with_ten = count_queries["n"]

        assert with_four == with_ten, f"{with_four} против {with_ten} запросов"

    @pytest.mark.parametrize("broken", ["partial", "duplicate", "foreign"])
    async def test_rejects_incomplete_order(self, client, broken):
        auth = await account(client, "owner@example.test")
        tour_id, step_ids = await tour_with_steps(client, auth, count=3)

        orders = {
            "partial": step_ids[:2],
            "duplicate": [step_ids[0], step_ids[0], step_ids[1]],
            "foreign": [*step_ids[:2], str(uuid.uuid4())],
        }

        response = await client.put(
            f"/v1/tours/{tour_id}/steps/order", json={"step_ids": orders[broken]}, headers=auth
        )

        assert response.status_code == 422


class TestDelete:
    async def test_compacts_positions(self, client):
        auth = await account(client, "owner@example.test")
        tour_id, step_ids = await tour_with_steps(client, auth, count=3)

        response = await client.delete(f"/v1/steps/{step_ids[0]}", headers=auth)

        assert response.status_code == 200
        assert response.json()["steps_count"] == 2
        tour = (await client.get(f"/v1/tours/{tour_id}", headers=auth)).json()
        # Позиции сжаты: без дыры на месте удалённого.
        assert [step["position"] for step in tour["steps"]] == [0, 1]

    async def test_last_step_unpublishes_tour(self, client):
        auth = await account(client, "owner@example.test")
        tour_id, step_ids = await tour_with_steps(client, auth, count=1)
        published = await client.post(f"/v1/tours/{tour_id}/publish", headers=auth)
        assert published.json()["status"] == "published"

        response = await client.delete(f"/v1/steps/{step_ids[0]}", headers=auth)

        body = response.json()
        assert body["steps_count"] == 0
        # Опубликованный тур без шагов хуже, чем запрет удаления.
        assert body["tour_status"] == "draft"

    async def test_deleting_not_last_step_keeps_publication(self, client):
        auth = await account(client, "owner@example.test")
        tour_id, step_ids = await tour_with_steps(client, auth, count=2)
        await client.post(f"/v1/tours/{tour_id}/publish", headers=auth)

        body = (await client.delete(f"/v1/steps/{step_ids[0]}", headers=auth)).json()

        assert body["tour_status"] == "published"


class TestTenantIsolation:
    @pytest.fixture
    async def foreign_step(self, client):
        first = await account(client, "first@example.test")
        second = await account(client, "second@example.test")
        tour_id, step_ids = await tour_with_steps(client, second, count=2)
        return {"auth": first, "tour_id": tour_id, "step_id": step_ids[0], "all": step_ids}

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("patch", "/v1/steps/{step}", {"title": "Чужое"}),
            ("delete", "/v1/steps/{step}", None),
        ],
    )
    async def test_foreign_step_is_not_found(self, client, foreign_step, method, path, body):
        kwargs = {"headers": foreign_step["auth"]} | ({"json": body} if body else {})

        response = await getattr(client, method)(
            path.format(step=foreign_step["step_id"]), **kwargs
        )

        assert response.status_code == 404
        assert response.json()["type"] == "/errors/not-found"

    async def test_foreign_tour_steps_cannot_be_created_or_reordered(self, client, foreign_step):
        auth = foreign_step["auth"]
        tour_id = foreign_step["tour_id"]

        created = await client.post(
            f"/v1/tours/{tour_id}/steps",
            json={"selector": "#цель", "body": "Текст"},
            headers=auth,
        )
        reordered = await client.put(
            f"/v1/tours/{tour_id}/steps/order",
            json={"step_ids": list(reversed(foreign_step["all"]))},
            headers=auth,
        )

        assert created.status_code == 404
        assert reordered.status_code == 404


class TestConcurrentReorder:
    """Две одновременные перестановки одного тура.

    Этот тест работает вне общей транзакции: нужны два реальных соединения,
    а фикстура `db` держит одно. Поэтому данные создаются и удаляются внутри
    теста.
    """

    async def test_two_reorders_do_not_break_uniqueness(self, engine):
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as setup:
            user_id = await setup.scalar(
                text("INSERT INTO users (email, password_hash) VALUES (:email, 'x') RETURNING id"),
                {"email": f"concurrent-{uuid.uuid4().hex[:8]}@example.test"},
            )
            project_id = await setup.scalar(
                text(
                    "INSERT INTO projects (user_id, name, public_key, theme)"
                    " VALUES (:user, 'Сайт', :key, '{}'::jsonb) RETURNING id"
                ),
                {"user": user_id, "key": "pk_" + uuid.uuid4().hex},
            )
            tour_id = await setup.scalar(
                text("INSERT INTO tours (project_id, name) VALUES (:project, 'Тур') RETURNING id"),
                {"project": project_id},
            )
            for index in range(4):
                await setup.execute(
                    text(
                        "INSERT INTO steps (tour_id, position, selector, body)"
                        " VALUES (:tour, :pos, '#цель', 'Текст')"
                    ),
                    {"tour": tour_id, "pos": index},
                )
            await setup.commit()

        try:
            async with factory() as first_session, factory() as second_session:
                tour = await first_session.get(Tour, tour_id)
                ids = list(
                    await first_session.scalars(
                        select(Step.id).where(Step.tour_id == tour_id).order_by(Step.position)
                    )
                )

                async def run(session, order):
                    tour_in_session = await session.get(Tour, tour_id)
                    await steps_service.reorder(session, tour_in_session, order)
                    await session.commit()

                await asyncio.gather(
                    run(first_session, list(reversed(ids))),
                    run(second_session, [ids[1], ids[0], ids[3], ids[2]]),
                )

                assert tour is not None

            async with factory() as check:
                positions = list(
                    await check.scalars(
                        select(Step.position).where(Step.tour_id == tour_id).order_by(Step.position)
                    )
                )
            # Какая из перестановок победила — неважно; важно, что результат
            # остался корректной перестановкой без дублей и дыр.
            assert positions == [0, 1, 2, 3]
        finally:
            async with factory() as cleanup:
                await cleanup.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
                await cleanup.commit()
