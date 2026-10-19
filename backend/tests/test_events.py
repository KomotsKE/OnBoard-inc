"""Приём событий (T4.1).

Эндпоинт принимает данные с чужих страниц, поэтому проверяется и то, что он
записывает, и то, что он отказывается записывать — и то, что он никогда не
просит виджет повторить попытку без смысла.
"""

import json
import uuid

import pytest
from sqlalchemy import func, select

from app.models import Event
from app.schemas.events import BATCH_MAX

PASSWORD = "очень-длинный-пароль-владельца"
ORIGIN = "http://site.test"


async def account(client, email: str = "owner@example.test") -> dict[str, str]:
    response = await client.post("/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def project_with_origin(client, auth) -> dict:
    created = await client.post("/v1/projects", json={"name": "Сайт"}, headers=auth)
    project = created.json()
    patched = await client.patch(
        f"/v1/projects/{project['id']}",
        json={"allowed_origins": [ORIGIN]},
        headers=auth,
    )
    assert patched.status_code == 200, patched.text
    return patched.json()


def event(**overrides) -> dict:
    return {
        "event_id": str(uuid.uuid4()),
        "type": "tour_started",
        "run_id": str(uuid.uuid4()),
        "visitor_id": str(uuid.uuid4()),
        "url": "/reports",
        "device": "desktop",
        **overrides,
    }


async def send(client, key: str, events: list[dict], origin: str | None = ORIGIN, **kwargs):
    headers = {"Origin": origin} if origin is not None else {}
    return await client.post(
        "/v1/public/events", json={"key": key, "events": events}, headers=headers, **kwargs
    )


async def stored(db, project_id: str) -> int:
    count = await db.scalar(
        select(func.count()).select_from(Event).where(Event.project_id == uuid.UUID(project_id))
    )
    return count or 0


class TestIngest:
    async def test_accepts_batch_and_answers_204(self, client, db):
        auth = await account(client)
        project = await project_with_origin(client, auth)

        response = await send(client, project["public_key"], [event(), event()])

        assert response.status_code == 204
        assert await stored(db, project["id"]) == 2

    async def test_same_batch_twice_gives_one_row_each(self, client, db):
        """Идемпотентность по event_id (инвариант №8).

        Повторная доставка — норма: `sendBeacon` может уйти дважды, а виджет
        повторяет батч после отказа сети.
        """
        auth = await account(client)
        project = await project_with_origin(client, auth)
        batch = [event(), event()]

        await send(client, project["public_key"], batch)
        second = await send(client, project["public_key"], batch)

        assert second.status_code == 204
        assert await stored(db, project["id"]) == 2

    async def test_writes_batch_in_one_statement(self, client, count_queries, db):
        auth = await account(client)
        project = await project_with_origin(client, auth)

        count_queries["n"] = 0
        await send(client, project["public_key"], [event() for _ in range(3)])
        with_three = count_queries["n"]

        count_queries["n"] = 0
        await send(client, project["public_key"], [event() for _ in range(30)])

        # Число запросов не растёт с размером батча: вставка одна (§12.7).
        assert count_queries["n"] == with_three

    async def test_keeps_path_and_drops_query(self, client, db):
        auth = await account(client)
        project = await project_with_origin(client, auth)

        await send(
            client,
            project["public_key"],
            [event(url="https://site.test/reports?token=секрет&email=a@b.c")],
        )

        saved = await db.scalar(select(Event.url_path))
        # В параметрах чужого сайта живут токены и адреса почты (инвариант №7).
        assert saved == "/reports"

    async def test_accepts_body_sent_as_text_plain(self, client, db):
        """`navigator.sendBeacon` отправляет строку с Content-Type: text/plain."""
        auth = await account(client)
        project = await project_with_origin(client, auth)

        body = json.dumps(
            {
                "key": project["public_key"],
                "events": [{"event_id": str(uuid.uuid4()), "type": "widget_ping"}],
            }
        )

        response = await client.post(
            "/v1/public/events",
            content=body,
            headers={"Origin": ORIGIN, "Content-Type": "text/plain;charset=UTF-8"},
        )

        assert response.status_code == 204
        assert await stored(db, project["id"]) == 1


class TestRejects:
    async def test_broken_event_is_dropped_without_asking_to_retry(self, client, db):
        """Повтор не починит битое событие, поэтому ответ всё равно 204."""
        auth = await account(client)
        project = await project_with_origin(client, auth)

        response = await send(
            client,
            project["public_key"],
            [event(), {"event_id": "не uuid", "type": "tour_started"}, event(type="выдумка")],
        )

        assert response.status_code == 204
        assert await stored(db, project["id"]) == 1

    async def test_foreign_origin_is_refused(self, client, db):
        auth = await account(client)
        project = await project_with_origin(client, auth)

        response = await send(client, project["public_key"], [event()], origin="http://evil.test")

        assert response.status_code == 403
        assert await stored(db, project["id"]) == 0

    async def test_unknown_key_is_not_found(self, client):
        response = await send(client, "pk_" + "0" * 32, [event()])

        assert response.status_code == 404

    @pytest.mark.parametrize(
        "body",
        [
            {"events": [{"type": "tour_started"}]},
            {"key": "не ключ", "events": []},
            {"key": "pk_" + "0" * 32},
        ],
    )
    async def test_broken_envelope_is_rejected(self, client, body):
        # Конверт — другое дело: без ключа принимать нечего и некуда.
        response = await client.post("/v1/public/events", json=body, headers={"Origin": ORIGIN})

        assert response.status_code == 422

    async def test_oversized_batch_is_rejected(self, client):
        auth = await account(client)
        project = await project_with_origin(client, auth)

        response = await send(
            client, project["public_key"], [event() for _ in range(BATCH_MAX + 1)]
        )

        assert response.status_code == 422

    async def test_rate_limit_answers_429_with_retry_after(self, client):
        from app.main import app

        auth = await account(client)
        project = await project_with_origin(client, auth)
        key = project["public_key"]
        limit, window = 100, 60
        for _ in range(limit):
            app.state.rate_limiter.allow(f"events:{key}:127.0.0.1", limit, window)

        response = await send(client, key, [event()])

        assert response.status_code == 429
        assert int(response.headers["Retry-After"]) > 0
