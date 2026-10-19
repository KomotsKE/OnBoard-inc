"""Воронка тура (T4.3).

Числа проверяются против формул §7.2 docs/vision.md, посчитанных вручную на
фикстуре из десяти прогонов: 3 завершения, 5 скипов, 2 обрыва.
"""

import uuid

import pytest

from app.models import Project, Tour
from tests.factories import make_event

PASSWORD = "очень-длинный-пароль-владельца"

# Фикстура из критерия задачи.
COMPLETED = 3
SKIPPED = 5
DROPPED = 2
RUNS = COMPLETED + SKIPPED + DROPPED


async def account(client, email: str = "owner@example.test") -> dict[str, str]:
    response = await client.post("/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def tour_with_steps(client, auth, steps: int = 3) -> dict:
    project_id = (await client.post("/v1/projects", json={"name": "Сайт"}, headers=auth)).json()[
        "id"
    ]
    tour = (
        await client.post(
            f"/v1/projects/{project_id}/tours", json={"name": "Знакомство"}, headers=auth
        )
    ).json()
    for index in range(steps):
        await client.post(
            f"/v1/tours/{tour['id']}/steps",
            json={"selector": f"#шаг-{index}", "body": "Текст", "title": f"Шаг {index}"},
            headers=auth,
        )
    return {"project_id": project_id, "tour_id": tour["id"]}


async def run(db, project, tour, *, viewed: int, outcome: str | None, days_ago: int = 0) -> None:
    """Один прогон: запуск, просмотренные шаги и исход."""
    run_id = uuid.uuid4()
    await make_event(
        db, project=project, tour=tour, type="tour_started", run_id=run_id, days_ago=days_ago
    )
    for position in range(viewed):
        await make_event(
            db,
            project=project,
            tour=tour,
            type="step_viewed",
            run_id=run_id,
            step_position=position,
            days_ago=days_ago,
        )
    if outcome:
        await make_event(
            db,
            project=project,
            tour=tour,
            type=outcome,
            run_id=run_id,
            step_position=viewed - 1,
            days_ago=days_ago,
        )


@pytest.fixture
async def ten_runs(client, db):
    """3 завершения на всех шагах, 5 скипов на втором шаге, 2 обрыва на первом."""
    auth = await account(client)
    ids = await tour_with_steps(client, auth)
    project = await db.get(Project, uuid.UUID(ids["project_id"]))
    tour = await db.get(Tour, uuid.UUID(ids["tour_id"]))

    for _ in range(COMPLETED):
        await run(db, project, tour, viewed=3, outcome="tour_completed")
    for _ in range(SKIPPED):
        await run(db, project, tour, viewed=2, outcome="tour_skipped")
    for _ in range(DROPPED):
        await run(db, project, tour, viewed=1, outcome=None)

    return {"auth": auth, **ids}


async def analytics(client, ten_runs, window: str = "7d") -> dict:
    response = await client.get(
        f"/v1/tours/{ten_runs['tour_id']}/analytics?range={window}", headers=ten_runs["auth"]
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestTotals:
    async def test_counts_match_formulas(self, client, ten_runs):
        body = await analytics(client, ten_runs)

        assert body["totals"] == {
            "runs": RUNS,
            "completed": COMPLETED,
            "skipped": SKIPPED,
            # Брошено без явного скипа = запуски − завершения − скипы.
            "dropped": DROPPED,
            "completion_rate": round(COMPLETED / RUNS, 4),
            "skip_rate": round(SKIPPED / RUNS, 4),
        }

    async def test_tour_without_events_shows_zeros_not_errors(self, client):
        auth = await account(client)
        ids = await tour_with_steps(client, auth)

        response = await client.get(f"/v1/tours/{ids['tour_id']}/analytics", headers=auth)

        body = response.json()
        assert body["totals"]["runs"] == 0
        # Ноль процентов при нуле запусков — это ноль, а не деление на ноль.
        assert body["totals"]["completion_rate"] == 0.0
        assert body["problem_step"] is None


class TestFunnel:
    async def test_steps_match_manual_count(self, client, ten_runs):
        body = await analytics(client, ten_runs)

        # Шаг 1 видели все 10, шаг 2 — 8 (без двух обрывов), шаг 3 — только 3.
        assert [(step["step_position"], step["runs"]) for step in body["funnel"]] == [
            (0, 10),
            (1, 8),
            (2, 3),
        ]
        assert [step["rate"] for step in body["funnel"]] == [1.0, 0.8, 0.3]

    async def test_drop_off_is_loss_to_the_next_step(self, client, ten_runs):
        body = await analytics(client, ten_runs)

        drops = [step["drop_off"] for step in body["funnel"]]
        # 1 − 8/10, 1 − 3/8, и у последнего — 1 − завершения/3.
        assert drops == [0.2, 0.625, 0.0]

    async def test_problem_step_is_the_worst_one(self, client, ten_runs):
        body = await analytics(client, ten_runs)

        # Между вторым и третьим шагом теряется 62,5 % — это и есть проблема.
        assert body["problem_step"] == 1

    async def test_funnel_follows_current_steps(self, client, ten_runs):
        body = await analytics(client, ten_runs)

        assert [step["title"] for step in body["funnel"]] == ["Шаг 0", "Шаг 1", "Шаг 2"]
        assert [step["selector"] for step in body["funnel"]] == ["#шаг-0", "#шаг-1", "#шаг-2"]


class TestWindow:
    async def test_event_older_than_window_is_not_counted(self, client, db, ten_runs):
        project = await db.get(Project, uuid.UUID(ten_runs["project_id"]))
        tour = await db.get(Tour, uuid.UUID(ten_runs["tour_id"]))
        await run(db, project, tour, viewed=3, outcome="tour_completed", days_ago=10)

        week = await analytics(client, ten_runs, "7d")
        month = await analytics(client, ten_runs, "30d")

        # Одна и та же граница для тоталов и воронки: суммы сходятся между блоками.
        assert week["totals"]["runs"] == RUNS
        assert week["funnel"][0]["runs"] == RUNS
        assert month["totals"]["runs"] == RUNS + 1
        assert month["funnel"][0]["runs"] == RUNS + 1

    async def test_unknown_range_is_rejected(self, client, ten_runs):
        response = await client.get(
            f"/v1/tours/{ten_runs['tour_id']}/analytics?range=год", headers=ten_runs["auth"]
        )

        assert response.status_code == 422


class TestIssues:
    async def test_shows_missing_targets_with_selector(self, client, db, ten_runs):
        project = await db.get(Project, uuid.UUID(ten_runs["project_id"]))
        tour = await db.get(Tour, uuid.UUID(ten_runs["tour_id"]))
        for _ in range(4):
            await make_event(
                db,
                project=project,
                tour=tour,
                type="step_target_missing",
                step_position=1,
            )
        await make_event(db, project=project, tour=tour, type="widget_error")

        issues = (await analytics(client, ten_runs))["issues"]

        # Самое частое — первым: это список для разбора, а не хронология.
        assert issues[0] == {
            "type": "step_target_missing",
            "step_position": 1,
            "selector": "#шаг-1",
            "error_code": None,
            "count": 4,
        }
        assert issues[1]["type"] == "widget_error"

    async def test_events_of_another_project_do_not_leak(self, client, db, ten_runs):
        """Событие с чужим tour_id в свою воронку попасть не должно."""
        stranger = await account(client, "stranger@example.test")
        other = await tour_with_steps(client, stranger, steps=1)
        other_project = await db.get(Project, uuid.UUID(other["project_id"]))
        tour = await db.get(Tour, uuid.UUID(ten_runs["tour_id"]))

        await make_event(db, project=other_project, tour=tour, type="tour_started")

        assert (await analytics(client, ten_runs))["totals"]["runs"] == RUNS


class TestQueries:
    async def test_query_count_does_not_grow_with_events(self, client, count_queries, db, ten_runs):
        count_queries["n"] = 0
        await analytics(client, ten_runs)
        with_ten_runs = count_queries["n"]

        project = await db.get(Project, uuid.UUID(ten_runs["project_id"]))
        tour = await db.get(Tour, uuid.UUID(ten_runs["tour_id"]))
        for _ in range(40):
            await run(db, project, tour, viewed=3, outcome="tour_completed")

        count_queries["n"] = 0
        await analytics(client, ten_runs)

        # Воронка считается одним агрегатом: цикл по событиям в Python и
        # запрос на шаг одинаково запрещены (§4.5 docs/vision.md).
        assert count_queries["n"] == with_ten_runs
