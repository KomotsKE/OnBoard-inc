"""Аутентификация: вход, ротация refresh-токена, обнаружение кражи, лимиты."""

import re

import pytest
from sqlalchemy import text

PASSWORD = "очень-длинный-пароль-владельца"
EMAIL = "owner@example.test"


async def register(client, email: str = EMAIL, password: str = PASSWORD):
    return await client.post("/v1/auth/register", json={"email": email, "password": password})


def refresh_cookie(response) -> str:
    cookie = response.headers.get("set-cookie", "")
    match = re.search(r"onboard_rt=([^;]+)", cookie)
    assert match, f"в ответе нет cookie с refresh-токеном: {cookie!r}"
    return match.group(1)


class TestRegistration:
    async def test_registers_and_issues_tokens(self, client):
        response = await register(client)

        assert response.status_code == 201
        body = response.json()
        assert body["expires_in"] == 15 * 60
        assert body["access_token"]

        cookie = response.headers["set-cookie"]
        assert "HttpOnly" in cookie
        assert "Path=/v1/auth" in cookie
        # Secure в dev выключен сознательно: иначе cookie не работает по http.
        assert "Secure" not in cookie

    async def test_rejects_duplicate_email(self, client):
        await register(client)

        response = await register(client)

        assert response.status_code == 409
        assert response.headers["content-type"].startswith("application/problem+json")

    async def test_normalises_email_case(self, client, db):
        await register(client, email="Owner@Example.TEST")

        stored = await db.scalar(text("SELECT email FROM users"))
        assert stored == "owner@example.test"

    @pytest.mark.parametrize(
        "password",
        [
            "короткий",
            "qwertyuiopas",  # ровно 12 — ниже минимума 15
            "x" * 129,
        ],
    )
    async def test_rejects_password_by_length(self, client, password):
        response = await register(client, password=password)

        assert response.status_code == 422

    async def test_rejects_password_from_breach_list(self, client):
        """Единственная запись списка, проходящая по длине.

        В списке top-10000 ровно одна запись длиной 15+ символов — остальные
        отсекает минимальная длина (§5.1 docs/data-model.md). Проверка нужна,
        чтобы механизм сверки со списком не отключился незаметно.
        """
        response = await register(client, password="films+pic+galeries")

        assert response.status_code == 422

    async def test_accepts_long_passphrase_with_spaces(self, client):
        response = await register(client, password="пароль из нескольких слов и пробелов")

        assert response.status_code == 201


class TestLogin:
    async def test_logs_in_with_correct_password(self, client):
        await register(client)

        response = await client.post("/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})

        assert response.status_code == 200
        assert response.json()["access_token"]

    async def test_rejects_wrong_password(self, client):
        await register(client)

        response = await client.post(
            "/v1/auth/login", json={"email": EMAIL, "password": "другой-длинный-пароль"}
        )

        assert response.status_code == 401

    async def test_unknown_email_looks_the_same_as_wrong_password(self, client):
        await register(client)

        wrong = await client.post(
            "/v1/auth/login", json={"email": EMAIL, "password": "другой-длинный-пароль"}
        )
        unknown = await client.post(
            "/v1/auth/login", json={"email": "никого@example.test", "password": PASSWORD}
        )

        # Разные ответы превратили бы форму входа в список существующих аккаунтов.
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json()["title"] == unknown.json()["title"]


class TestAccessToken:
    async def test_me_returns_owner(self, client):
        token = (await register(client)).json()["access_token"]

        response = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 200
        assert response.json()["email"] == EMAIL

    @pytest.mark.parametrize(
        "header",
        ["", "Bearer", "Bearer not-a-token", "Basic abc", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x"],
    )
    async def test_me_rejects_bad_tokens(self, client, header):
        response = await client.get("/v1/me", headers={"Authorization": header})

        assert response.status_code == 401


class TestRefreshRotation:
    async def test_rotates_and_returns_new_tokens(self, client):
        first = await register(client)
        old_cookie = refresh_cookie(first)

        response = await client.post("/v1/auth/refresh")

        assert response.status_code == 200
        assert refresh_cookie(response) != old_cookie

    async def test_requires_cookie(self, client):
        response = await client.post("/v1/auth/refresh")

        assert response.status_code == 401

    async def test_reused_token_closes_whole_family(self, client, db):
        await register(client)
        stolen = client.cookies.get("onboard_rt", path="/v1/auth")

        # Законная ротация: токен становится использованным.
        await client.post("/v1/auth/refresh")
        current = client.cookies.get("onboard_rt", path="/v1/auth")
        assert current != stolen

        # Предъявление старого токена — признак кражи.
        client.cookies.set("onboard_rt", stolen, path="/v1/auth")
        reuse = await client.post("/v1/auth/refresh")

        assert reuse.status_code == 401
        revoked = await db.scalar(
            text("SELECT count(*) FROM refresh_sessions WHERE revoked_at IS NULL")
        )
        assert revoked == 0, "после обнаружения кражи не должно остаться живых токенов цепочки"

        # И новый, честно полученный токен тоже больше не работает.
        client.cookies.set("onboard_rt", current, path="/v1/auth")
        after = await client.post("/v1/auth/refresh")
        assert after.status_code == 401


class TestLogout:
    async def test_logout_invalidates_cookie(self, client):
        await register(client)

        response = await client.post("/v1/auth/logout")

        assert response.status_code == 204
        after = await client.post("/v1/auth/refresh")
        assert after.status_code == 401


class TestRateLimits:
    async def test_login_is_limited_by_ip(self, client):
        await register(client)
        body = {"email": EMAIL, "password": "неверный-но-достаточно-длинный"}

        statuses = [(await client.post("/v1/auth/login", json=body)).status_code for _ in range(11)]

        assert statuses.count(429) >= 1, statuses
        limited = await client.post("/v1/auth/login", json=body)
        assert limited.status_code == 429
        assert limited.headers["retry-after"].isdigit()

    async def test_failed_logins_are_limited_by_email(self, client):
        """Лимит по адресу нужен отдельно: по IP он не мешает подбирать пароль
        к одному аккаунту с распределённых адресов."""
        await register(client)
        body = {"email": EMAIL, "password": "неверный-но-достаточно-длинный"}

        for index in range(6):
            response = await client.post(
                "/v1/auth/login", json=body, headers={"X-Forwarded-For": f"10.0.0.{index}"}
            )

        assert response.status_code == 429
