import pytest
from pydantic import ValidationError

from app.core.config import Settings, unknown_settings_keys

REQUIRED = {
    "ONBOARD_DATABASE_URL": "postgresql+psycopg://u:p@localhost:5432/db",
    "ONBOARD_JWT_SECRET": "секрет-для-теста",
    "ONBOARD_EDITOR_TOKEN_SECRET": "второй-секрет-для-теста",
    "ONBOARD_PUBLIC_API_URL": "http://localhost:8000",
    "ONBOARD_PANEL_ORIGIN": "http://localhost:5173",
}


@pytest.fixture
def env(monkeypatch):
    """Окружение с нуля: .env проекта и переменные compose не должны влиять."""
    for key in list(REQUIRED) + ["ONBOARD_ENV", "ONBOARD_LOG_LEVEL", "ONBOARD_JWT_SECRIT"]:
        monkeypatch.delenv(key, raising=False)
    for key, value in REQUIRED.items():
        monkeypatch.setenv(key, value)
    return monkeypatch


def test_missing_secret_stops_startup(env):
    env.delenv("ONBOARD_JWT_SECRET")

    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None)

    assert "jwt_secret" in str(exc.value)


def test_typo_in_variable_name_is_detected(env, tmp_path):
    """Опечатка не должна тихо остаться значением по умолчанию.

    Проверяются оба источника: переменная окружения и файл .env — pydantic
    сам ловит только второй, поэтому проверка своя (§13.1 conventions).
    """
    env.setenv("ONBOARD_JWT_SECRIT", "oops")
    assert unknown_settings_keys(tmp_path / "нет-файла") == ["ONBOARD_JWT_SECRIT"]

    env.delenv("ONBOARD_JWT_SECRIT")
    dotenv = tmp_path / ".env"
    dotenv.write_text("ONBOARD_POOL_SIZE=20\n", encoding="utf-8")
    assert unknown_settings_keys(dotenv) == ["ONBOARD_POOL_SIZE"]


def test_foreign_variables_are_ignored(env, tmp_path):
    """Переменные compose лежат в том же .env и не должны ломать старт."""
    env.setenv("POSTGRES_USER", "onboard")
    env.setenv("TESTSITE_PORT", "8080")
    dotenv = tmp_path / ".env"
    dotenv.write_text("POSTGRES_USER=onboard\nTESTSITE_PORT=8080\n", encoding="utf-8")

    assert unknown_settings_keys(dotenv) == []
    assert Settings(_env_file=dotenv).env == "dev"


def test_secret_is_not_printable(env):
    settings = Settings(_env_file=None)

    assert "секрет-для-теста" not in repr(settings)
    assert "секрет-для-теста" not in str(settings.jwt_secret)
    assert settings.jwt_secret.get_secret_value() == "секрет-для-теста"


def test_timeout_defaults_match_documented_values(env):
    settings = Settings(_env_file=None)

    assert settings.db_statement_timeout_public_ms == 2_000
    assert settings.db_statement_timeout_panel_ms == 5_000
    assert settings.db_pool_timeout_s == 5
