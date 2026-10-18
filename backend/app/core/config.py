"""Единственная точка доступа к настройкам (§13.1 docs/conventions.md)."""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_PREFIX = "ONBOARD_"


class Settings(BaseSettings):
    # Префикс ONBOARD_ отделяет настройки приложения от переменных compose
    # (POSTGRES_USER, TESTSITE_PORT и прочих), которые лежат в том же .env.
    #
    # extra="ignore", а не "forbid": в .env соседствуют чужие переменные, и
    # forbid отверг бы их, уронив запуск вне контейнера. Защиту от опечаток
    # в именах даёт unknown_settings_keys() — она, в отличие от forbid,
    # проверяет и окружение, и файл.
    model_config = SettingsConfigDict(
        env_prefix=ENV_PREFIX,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    env: Literal["dev", "prod"] = "dev"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # Без значений по умолчанию: отсутствие валит старт, а не подставляет
    # предсказуемый секрет.
    database_url: str
    jwt_secret: SecretStr
    editor_token_secret: SecretStr
    public_api_url: AnyHttpUrl
    panel_origin: AnyHttpUrl
    # Где отдаются бандлы виджета. В разработке это nginx со стендом, в проде —
    # API или CDN; сниппет у клиента ссылается именно сюда.
    widget_base_url: AnyHttpUrl

    # Пул и таймауты — §9.1 docs/vision.md.
    db_pool_size: int = 10
    db_max_overflow: int = 10
    db_pool_timeout_s: int = 5
    db_pool_recycle_s: int = 1800
    db_statement_timeout_public_ms: int = 2_000
    db_statement_timeout_panel_ms: int = 5_000

    # Сроки жизни токенов — ADR-0008, §9 docs/data-model.md.
    access_token_ttl_min: int = 15
    refresh_token_ttl_days: int = 30
    editor_token_ttl_min: int = 15


class UnknownSettingError(RuntimeError):
    """Переменная с нашим префиксом, которой нет среди полей Settings."""


def _dotenv_keys(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    keys = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith(ENV_PREFIX) and "=" in line:
            keys.add(line.split("=", 1)[0].strip())
    return keys


def unknown_settings_keys(env_file: str | Path = ".env") -> list[str]:
    """Переменные `ONBOARD_*`, которых нет среди полей Settings.

    Ловит `ONBOARD_JWT_SECRIT` и подобное: опечатка иначе осталась бы
    значением по умолчанию и проявилась бы уже на проде.
    """
    known = {f"{ENV_PREFIX}{name.upper()}" for name in Settings.model_fields}
    seen = {key for key in os.environ if key.startswith(ENV_PREFIX)}
    seen |= _dotenv_keys(Path(env_file))
    return sorted(seen - known)


@lru_cache
def get_settings() -> Settings:
    """Настройки читаются один раз на процесс; в тестах подменяются
    переопределением зависимости FastAPI."""
    if unknown := unknown_settings_keys():
        raise UnknownSettingError(
            "неизвестные переменные с префиксом " + ENV_PREFIX + ": " + ", ".join(unknown)
        )
    return Settings()
