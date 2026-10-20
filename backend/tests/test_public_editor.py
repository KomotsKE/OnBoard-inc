"""Публичный контур редактора: чтение тура по токену и правка его шагов.

Токен берётся там же, где его возьмёт панель, — у `POST /v1/tours/{id}/editor-session`
(T5.1). Отдельной фабрики токенов нет намеренно: тест, который подписывает токен
сам, перестаёт замечать расхождение между выдачей и приёмом.
"""

from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.config import get_settings

PASSWORD = "очень-длинный-пароль-владельца"
SITE = "https://site.example"
PAGE = f"{SITE}/reports"
CORS = {"Origin": SITE}


async def account(client, email: str = "owner@example.test") -> dict[str, str]:
    response = await client.post("/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def tour_with_token(client, auth, mode: str = "edit") -> tuple[str, str]:
    """Тур на разрешённом домене и токен редактора к нему."""
    project_id = (await client.post("/v1/projects", json={"name": "Сайт"}, headers=auth)).json()[
        "id"
    ]
    await client.patch(f"/v1/projects/{project_id}", json={"allowed_origins": [SITE]}, headers=auth)
    tour_id = (
        await client.post(
            f"/v1/projects/{project_id}/tours", json={"name": "Знакомство"}, headers=auth
        )
    ).json()["id"]
    issued = await client.post(
        f"/v1/tours/{tour_id}/editor-session",
        json={"page_url": PAGE, "mode": mode},
        headers=auth,
    )
    assert issued.status_code == 200, issued.text
    return tour_id, issued.json()["url"].rsplit("onboard_edit=", 1)[1]


async def add_step(client, token: str, **step) -> tuple[int, dict]:
    body = {"selector": "#цель", "body": "Текст шага"} | step
    response = await client.post(
        "/v1/public/editor/steps", json={"token": token, "step": body}, headers=CORS
    )
    return response.status_code, response.json() if response.content else {}


class TestSession:
    async def test_returns_tour_steps_and_theme(self, client):
        auth = await account(client)
        tour_id, token = await tour_with_token(client, auth)
        await add_step(client, token, body="Первый")

        response = await client.get(f"/v1/public/editor/session?token={token}", headers=CORS)

        assert response.status_code == 200, response.text
        state = response.json()
        assert state["mode"] == "edit"
        assert state["tour"] == {"id": tour_id, "name": "Знакомство"}
        assert [step["body"] for step in state["steps"]] == ["Первый"]
        # Тема нужна, чтобы подсказка в редакторе выглядела как у посетителя.
        assert state["theme"]["primary_color"]

    async def test_echoes_checked_origin(self, client):
        auth = await account(client)
        _, token = await tour_with_token(client, auth)

        response = await client.get(f"/v1/public/editor/session?token={token}", headers=CORS)

        assert response.headers["access-control-allow-origin"] == SITE
        assert response.headers["vary"] == "Origin"

    async def test_preflight_is_answered(self, client):
        response = await client.options(
            "/v1/public/editor/steps",
            headers=CORS
            | {
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

        assert response.status_code == 204
        assert "POST" in response.headers["access-control-allow-methods"]
        assert "DELETE" in response.headers["access-control-allow-methods"]


class TestRefusals:
    async def test_expired_token_is_unauthorized(self, client):
        settings = get_settings()
        expired = jwt.encode(
            {
                "tour": "0b5b3c4e-0000-4000-8000-000000000000",
                "mode": "edit",
                "exp": datetime.now(UTC) - timedelta(seconds=1),
            },
            settings.editor_token_secret.get_secret_value(),
            algorithm="HS256",
        )

        response = await client.get(f"/v1/public/editor/session?token={expired}", headers=CORS)

        assert response.status_code == 401
        assert response.json()["type"] == "/errors/unauthorized"

    async def test_garbage_token_is_unauthorized(self, client):
        response = await client.get("/v1/public/editor/session?token=не-токен", headers=CORS)

        assert response.status_code == 401

    async def test_token_of_deleted_tour_is_not_found(self, client):
        auth = await account(client)
        tour_id, token = await tour_with_token(client, auth)
        assert (await client.delete(f"/v1/tours/{tour_id}", headers=auth)).status_code == 204

        response = await client.get(f"/v1/public/editor/session?token={token}", headers=CORS)

        assert response.status_code == 404

    async def test_origin_outside_allowed_is_forbidden(self, client):
        auth = await account(client)
        _, token = await tour_with_token(client, auth)

        response = await client.get(
            f"/v1/public/editor/session?token={token}",
            headers={"Origin": "https://other.example"},
        )

        assert response.status_code == 403

    async def test_rate_limit_applies_to_editor_routes(self, client):
        auth = await account(client)
        _, token = await tour_with_token(client, auth)

        statuses = set()
        for _ in range(61):
            response = await client.get(f"/v1/public/editor/session?token={token}", headers=CORS)
            statuses.add(response.status_code)

        assert statuses == {200, 429}


class TestSteps:
    async def test_step_created_by_token_is_visible_in_panel(self, client):
        auth = await account(client)
        tour_id, token = await tour_with_token(client, auth)

        status, created = await add_step(client, token, selector="#экспорт", body="Выгрузка")

        assert status == 201, created
        tour = (await client.get(f"/v1/tours/{tour_id}", headers=auth)).json()
        assert [(step["selector"], step["body"]) for step in tour["steps"]] == [
            ("#экспорт", "Выгрузка")
        ]
        assert created["id"] == tour["steps"][0]["id"]

    async def test_step_is_edited_and_deleted_by_token(self, client):
        auth = await account(client)
        tour_id, token = await tour_with_token(client, auth)
        _, created = await add_step(client, token)

        patched = await client.patch(
            f"/v1/public/editor/steps/{created['id']}",
            json={"token": token, "step": {"title": "Экспорт", "placement": "top"}},
            headers=CORS,
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["title"] == "Экспорт"
        assert patched.json()["placement"] == "top"

        removed = await client.delete(
            f"/v1/public/editor/steps/{created['id']}?token={token}", headers=CORS
        )
        assert removed.status_code == 204, removed.text
        assert (await client.get(f"/v1/tours/{tour_id}", headers=auth)).json()["steps"] == []

    async def test_step_of_another_tour_is_not_found(self, client):
        auth = await account(client)
        _, token = await tour_with_token(client, auth)
        other_auth = await account(client, "other@example.test")
        _, other_token = await tour_with_token(client, other_auth)
        _, foreign = await add_step(client, other_token)

        patched = await client.patch(
            f"/v1/public/editor/steps/{foreign['id']}",
            json={"token": token, "step": {"title": "Чужое"}},
            headers=CORS,
        )
        removed = await client.delete(
            f"/v1/public/editor/steps/{foreign['id']}?token={token}", headers=CORS
        )

        assert patched.status_code == 404
        assert removed.status_code == 404

    async def test_validation_of_step_still_applies(self, client):
        auth = await account(client)
        _, token = await tour_with_token(client, auth)

        status, _ = await add_step(client, token, selector="")

        assert status == 422


class TestPreviewMode:
    async def test_preview_token_reads_the_tour(self, client):
        auth = await account(client)
        _, token = await tour_with_token(client, auth, mode="preview")

        response = await client.get(f"/v1/public/editor/session?token={token}", headers=CORS)

        assert response.status_code == 200
        assert response.json()["mode"] == "preview"

    @pytest.mark.parametrize("method", ["post", "patch", "delete"])
    async def test_preview_token_does_not_change_steps(self, client, method):
        auth = await account(client)
        tour_id, edit_token = await tour_with_token(client, auth)
        _, created = await add_step(client, edit_token)
        # Второй токен на тот же тур: режим — единственное отличие.
        issued = await client.post(
            f"/v1/tours/{tour_id}/editor-session",
            json={"page_url": PAGE, "mode": "preview"},
            headers=auth,
        )
        preview = issued.json()["url"].rsplit("onboard_edit=", 1)[1]

        if method == "post":
            response = await client.post(
                "/v1/public/editor/steps",
                json={"token": preview, "step": {"selector": "#цель", "body": "Текст"}},
                headers=CORS,
            )
        elif method == "patch":
            response = await client.patch(
                f"/v1/public/editor/steps/{created['id']}",
                json={"token": preview, "step": {"title": "Нельзя"}},
                headers=CORS,
            )
        else:
            response = await client.delete(
                f"/v1/public/editor/steps/{created['id']}?token={preview}", headers=CORS
            )

        # 403, а не 404: объект свой и существует, отказ именно по режиму.
        assert response.status_code == 403
