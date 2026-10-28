"""Сессия режима редактора: выдача токена, его скоуп и проверка адреса страницы.

HTTP-отказы по токену (просроченный → 401) появятся в T5.2 вместе с публичными
эндпоинтами редактора: предъявлять токен пока некуда. Здесь проверяется то, что
наблюдаемо сейчас, — что выдаётся и что токен в себе несёт.
"""

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest

from app.core.config import get_settings
from app.core.security import create_access_token, read_editor_token

PASSWORD = "очень-длинный-пароль-владельца"
SITE = "https://site.example"


async def account(client, email: str) -> dict[str, str]:
    response = await client.post("/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def tour_on_site(client, auth, origins: list[str] | None = None) -> str:
    """Тур в проекте, которому разрешён домен стенда."""
    project_id = (await client.post("/v1/projects", json={"name": "Сайт"}, headers=auth)).json()[
        "id"
    ]
    patch = {"allowed_origins": [SITE] if origins is None else origins}
    response = await client.patch(f"/v1/projects/{project_id}", json=patch, headers=auth)
    assert response.status_code == 200, response.text
    tour = await client.post(
        f"/v1/projects/{project_id}/tours", json={"name": "Знакомство"}, headers=auth
    )
    assert tour.status_code == 201, tour.text
    return tour.json()["id"]


async def issue(client, auth, tour_id: str, **body) -> tuple[int, dict]:
    payload = {"page_url": f"{SITE}/reports"} | body
    response = await client.post(f"/v1/tours/{tour_id}/editor-session", json=payload, headers=auth)
    return response.status_code, response.json()


class TestIssue:
    async def test_returns_page_url_with_token(self, client):
        auth = await account(client, "owner@example.test")
        tour_id = await tour_on_site(client, auth)

        status, body = await issue(client, auth, tour_id)

        assert status == 200
        assert body["url"].startswith(f"{SITE}/reports?onboard_edit=")
        assert body["expires_in"] == get_settings().editor_token_ttl_min * 60

    async def test_token_is_scoped_to_this_tour_and_mode(self, client):
        auth = await account(client, "owner@example.test")
        tour_id = await tour_on_site(client, auth)

        _, body = await issue(client, auth, tour_id, mode="preview")

        token = body["url"].rsplit("onboard_edit=", 1)[1]
        scope = read_editor_token(get_settings(), token)
        assert scope is not None
        assert scope.tour_id == tour_id
        # Режим нужен ingest: в превью события аналитики не пишутся (T5.6).
        assert scope.mode == "preview"

    async def test_edit_is_the_default_mode(self, client):
        auth = await account(client, "owner@example.test")
        tour_id = await tour_on_site(client, auth)

        _, body = await issue(client, auth, tour_id)

        scope = read_editor_token(get_settings(), body["url"].rsplit("=", 1)[1])
        assert scope is not None and scope.mode == "edit"

    async def test_keeps_existing_query_and_hash_route(self, client):
        # Сайт на hash-роутинге: потеря «#/отчёты» увела бы владельца не на ту
        # страницу, а существующий параметр мог бы быть частью её состояния.
        auth = await account(client, "owner@example.test")
        tour_id = await tour_on_site(client, auth)

        _, body = await issue(client, auth, tour_id, page_url=f"{SITE}/app?tab=5#/отчёты")

        assert body["url"].startswith(f"{SITE}/app?tab=5&onboard_edit=")
        assert body["url"].endswith("#/отчёты")

    @pytest.mark.parametrize("stale", ["onboard_edit=OLD", "onboard_edit"])
    async def test_replaces_stale_token_from_copied_address(self, client, stale):
        # Владелец копирует адрес из строки браузера во время сессии редактора:
        # загрузчик читает первый onboard_edit, и протухший токен победил бы новый.
        auth = await account(client, "owner@example.test")
        tour_id = await tour_on_site(client, auth)

        _, body = await issue(client, auth, tour_id, page_url=f"{SITE}/app?{stale}")

        query = parse_qs(urlsplit(body["url"]).query, keep_blank_values=True)
        assert len(query["onboard_edit"]) == 1
        scope = read_editor_token(get_settings(), query["onboard_edit"][0])
        assert scope is not None and scope.tour_id == tour_id

    async def test_stale_token_removal_leaves_rest_of_query_byte_for_byte(self, client):
        # Пересборка через parse_qsl + urlencode переписала бы «+», «%20», ключ
        # без «=» и закодированные символы; query — часть состояния страницы.
        auth = await account(client, "owner@example.test")
        tour_id = await tour_on_site(client, auth)
        page_url = f"{SITE}/app?q=a+b%20c&onboard_edit=OLD&flag&x=%D0%B0%2F#/отчёты"

        _, body = await issue(client, auth, tour_id, page_url=page_url)

        assert body["url"].startswith(f"{SITE}/app?q=a+b%20c&flag&x=%D0%B0%2F&onboard_edit=")
        assert body["url"].endswith("#/отчёты")
        assert "onboard_edit=OLD" not in body["url"]


class TestRefusals:
    async def test_foreign_tour_is_not_found(self, client):
        owner = await account(client, "owner@example.test")
        tour_id = await tour_on_site(client, owner)
        stranger = await account(client, "stranger@example.test")

        status, _ = await issue(client, stranger, tour_id)

        assert status == 404

    async def test_unknown_tour_is_not_found(self, client):
        auth = await account(client, "owner@example.test")

        status, _ = await issue(client, auth, "0b5b3c4e-0000-4000-8000-000000000000")

        assert status == 404

    @pytest.mark.parametrize(
        "page_url",
        [
            "https://другой-сайт.example/reports",  # домена нет в allowed_origins
            f"{SITE}:8443/reports",  # тот же хост, другой порт — другой origin
        ],
    )
    async def test_page_outside_allowed_origins_is_rejected(self, client, page_url):
        auth = await account(client, "owner@example.test")
        tour_id = await tour_on_site(client, auth)

        status, body = await issue(client, auth, tour_id, page_url=page_url)

        assert status == 422
        assert "origin" in body["detail"] or "домен" in body["detail"]

    @pytest.mark.parametrize("page_url", ["не адрес", "javascript:alert(1)", "/reports"])
    async def test_malformed_page_url_is_rejected(self, client, page_url):
        auth = await account(client, "owner@example.test")
        tour_id = await tour_on_site(client, auth)

        status, _ = await issue(client, auth, tour_id, page_url=page_url)

        assert status == 422


class TestToken:
    def test_expired_token_is_not_read(self):
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

        assert read_editor_token(settings, expired) is None

    def test_access_token_is_not_an_editor_token(self):
        # Разные секреты — токен панели не открывает редактор, и наоборот.
        settings = get_settings()
        access, _ = create_access_token(settings, "0b5b3c4e-0000-4000-8000-000000000000")

        assert read_editor_token(settings, access) is None
