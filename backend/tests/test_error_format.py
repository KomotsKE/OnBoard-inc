"""Ошибки самого фреймворка тоже обязаны быть в формате RFC 9457.

Замечание из T0.6: неизвестный маршрут отдавал {"detail": "Not Found"} вместо
application/problem+json, как требует §4 docs/conventions.md.
"""


async def test_unknown_route_returns_problem_json(client):
    response = await client.get("/нет-такого-пути")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"] == "/errors/http-404"
    assert body["status"] == 404
    assert body["title"]


async def test_wrong_method_returns_problem_json(client):
    response = await client.get("/v1/auth/login")

    assert response.status_code == 405
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["type"] == "/errors/http-405"


async def test_schema_validation_returns_problem_json_without_values(client):
    response = await client.post("/v1/auth/register", json={"email": "не-адрес", "password": "x"})

    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"] == "/errors/validation"
    assert sorted(body["fields"]) == ["email", "password"]
    # Значения полей в ответ не попадают: в теле бывают пароли.
    assert "x" not in body["detail"]
    assert "не-адрес" not in response.text
