"""Изоляция арендаторов целиком (T1.3).

Матрица не выписана руками, а строится из таблицы маршрутов приложения: любой
новый приватный маршрут с идентификатором в пути попадает в проверку сам. Если
для него не указано тело запроса, тест падает с внятным сообщением — это
дешевле, чем обнаружить утечку в проде.
"""

import ast
from pathlib import Path

import pytest
from starlette.routing import Route

from app.main import app

PASSWORD = "очень-длинный-пароль-владельца"
SITE = "https://site.example"

# Тела запросов для маршрутов, которые их требуют. Новый маршрут без записи
# здесь уронит тест полноты ниже.
BODIES: dict[tuple[str, str], dict | None] = {
    ("POST", "/v1/projects/{project_id}/tours"): {"name": "Чужое"},
    ("GET", "/v1/projects/{project_id}/tours"): None,
    ("GET", "/v1/projects/{project_id}"): None,
    ("PATCH", "/v1/projects/{project_id}"): {"name": "Чужое"},
    ("DELETE", "/v1/projects/{project_id}"): None,
    ("GET", "/v1/projects/{project_id}/snippet"): None,
    ("GET", "/v1/tours/{tour_id}"): None,
    ("GET", "/v1/tours/{tour_id}/analytics"): None,
    ("PATCH", "/v1/tours/{tour_id}"): {"name": "Чужое"},
    ("DELETE", "/v1/tours/{tour_id}"): None,
    ("POST", "/v1/tours/{tour_id}/editor-session"): {"page_url": f"{SITE}/отчёты"},
    ("POST", "/v1/tours/{tour_id}/publish"): None,
    ("POST", "/v1/tours/{tour_id}/unpublish"): None,
    ("POST", "/v1/tours/{tour_id}/steps"): {"selector": "#цель", "body": "Текст"},
    ("PUT", "/v1/tours/{tour_id}/steps/order"): {"step_ids": []},
    ("PATCH", "/v1/steps/{step_id}"): {"title": "Чужое"},
    ("DELETE", "/v1/steps/{step_id}"): None,
}


def private_routes() -> list[tuple[str, str]]:
    """Приватные маршруты панели с идентификатором в пути.

    Маршруты аутентификации и публичный контур виджета сюда не относятся:
    у первых нет владельца в пути, у второго своя модель доступа по ключу.
    """
    found = []
    for route in app.routes:
        if not isinstance(route, Route) or "{" not in route.path:
            continue
        if not route.path.startswith("/v1/") or route.path.startswith(("/v1/auth", "/v1/public")):
            continue
        for method in sorted(route.methods or set()):
            if method in {"HEAD", "OPTIONS"}:
                continue
            found.append((method, route.path))
    return sorted(found)


@pytest.fixture
async def two_owners(client):
    """Два владельца; у второго есть проект, тур и шаг."""
    tokens = {}
    for name, email in (("first", "first@example.test"), ("second", "second@example.test")):
        response = await client.post(
            "/v1/auth/register", json={"email": email, "password": PASSWORD}
        )
        assert response.status_code == 201, response.text
        tokens[name] = {"Authorization": f"Bearer {response.json()['access_token']}"}

    second = tokens["second"]
    project_id = (await client.post("/v1/projects", json={"name": "Чужой"}, headers=second)).json()[
        "id"
    ]
    tour_id = (
        await client.post(
            f"/v1/projects/{project_id}/tours", json={"name": "Чужой тур"}, headers=second
        )
    ).json()["id"]
    step_id = (
        await client.post(
            f"/v1/tours/{tour_id}/steps",
            json={"selector": "#цель", "body": "Текст"},
            headers=second,
        )
    ).json()["id"]

    return {
        "intruder": tokens["first"],
        "ids": {"project_id": project_id, "tour_id": tour_id, "step_id": step_id},
    }


def test_every_private_route_has_a_body_entry():
    """Полнота матрицы: новый маршрут обязан появиться в BODIES."""
    missing = [route for route in private_routes() if route not in BODIES]

    assert not missing, f"добавьте в BODIES: {missing}"


@pytest.mark.parametrize(("method", "path"), private_routes(), ids=lambda value: str(value))
async def test_foreign_object_is_not_found(client, two_owners, method, path):
    url = path.format(**two_owners["ids"])
    body = BODIES.get((method, path))
    kwargs = {"headers": two_owners["intruder"]} | ({"json": body} if body is not None else {})

    response = await client.request(method, url, **kwargs)

    assert response.status_code == 404, f"{method} {path} вернул {response.status_code}"
    # Именно 404, а не 403: ответ не должен подтверждать существование объекта.
    assert response.json()["type"] == "/errors/not-found"


@pytest.mark.parametrize(("method", "path"), private_routes(), ids=lambda value: str(value))
async def test_own_object_is_accessible(client, two_owners, method, path):
    """Обратная сторона: владелец своих объектов не теряет доступ.

    Без этой половины матрица проходила бы и на обработчике, который отвечает
    404 всем подряд.
    """
    owner = {"Authorization": two_owners["intruder"]["Authorization"]}
    project_id = (await client.post("/v1/projects", json={"name": "Свой"}, headers=owner)).json()[
        "id"
    ]
    tour_id = (
        await client.post(
            f"/v1/projects/{project_id}/tours", json={"name": "Свой тур"}, headers=owner
        )
    ).json()["id"]
    step_id = (
        await client.post(
            f"/v1/tours/{tour_id}/steps",
            json={"selector": "#цель", "body": "Текст"},
            headers=owner,
        )
    ).json()["id"]

    ids = {"project_id": project_id, "tour_id": tour_id, "step_id": step_id}
    body = BODIES.get((method, path))
    if (method, path) == ("PUT", "/v1/tours/{tour_id}/steps/order"):
        body = {"step_ids": [step_id]}
    if (method, path) == ("POST", "/v1/tours/{tour_id}/editor-session"):
        # Редактор открывается только на домене из allowed_origins, а проект
        # создаётся с пустым списком (fail closed, §8.1 docs/vision.md).
        await client.patch(
            f"/v1/projects/{project_id}", json={"allowed_origins": [SITE]}, headers=owner
        )
    kwargs = {"headers": owner} | ({"json": body} if body is not None else {})

    response = await client.request(method, path.format(**ids), **kwargs)

    assert response.status_code in (200, 201, 204), (
        f"{method} {path} вернул {response.status_code}: {response.text[:200]}"
    )


def test_panel_handlers_do_not_query_the_database_directly():
    """Обработчики панели обращаются к данным только через сервисы и зависимости.

    Прямой `session.get` или `select` в обработчике — это путь, на котором
    фильтр по владельцу забывают (ADR-0006). Проверка по исходникам: ревью
    диффа такое пропускает.
    """
    handlers = Path(__file__).resolve().parent.parent / "app" / "api" / "v1" / "panel"
    offenders = []

    for module in sorted(handlers.glob("*.py")):
        tree = ast.parse(module.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = (
                node.func.attr
                if isinstance(node.func, ast.Attribute)
                else getattr(node.func, "id", "")
            )
            if name in {"get", "select", "execute", "scalar", "scalars"} and isinstance(
                node.func, ast.Attribute | ast.Name
            ):
                target = getattr(node.func, "value", None)
                if isinstance(target, ast.Name) and target.id == "session":
                    offenders.append(f"{module.name}: session.{name}(…)")
                elif name == "select":
                    offenders.append(f"{module.name}: select(…)")

    assert not offenders, "обработчики панели работают с базой напрямую: " + ", ".join(offenders)
