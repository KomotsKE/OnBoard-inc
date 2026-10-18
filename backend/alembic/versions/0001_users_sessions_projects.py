"""Аккаунты, сессии, проекты

Миграция 001 из §3.1 docs/data-model.md. Туры и шаги — миграция 002 (T1.4),
события — 003 (T4.1).

Revision ID: 0001
Revises:
Create Date: 2026-10-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Нормализация email гарантируется на уровне БД: ни один путь записи
        # не должен обойти приведение к нижнему регистру (§5 data-model.md).
        sa.CheckConstraint("email = lower(email)", name="users_email_lower"),
        sa.CheckConstraint("char_length(email) BETWEEN 3 AND 254", name="users_email_len"),
    )
    op.create_index("users_email_key", "users", ["email"], unique=True)

    # Состояние, без которого ADR-0008 не может обнаружить повторное
    # использование украденного refresh-токена.
    op.create_table(
        "refresh_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=False),
        # Хранится sha256 от токена, а не сам токен: утечка дампа не даёт входа.
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("refresh_sessions_token_key", "refresh_sessions", ["token_hash"], unique=True)
    op.create_index("refresh_sessions_family_idx", "refresh_sessions", ["family_id"])
    op.create_index("refresh_sessions_user_idx", "refresh_sessions", ["user_id"])

    op.create_table(
        "projects",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column(
            "allowed_origins",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column(
            "theme",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("widget_last_seen_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 200", name="projects_name_len"),
        # Формат ключа не изменится, поэтому проверка в БД, а не в Pydantic
        # (правило разделения — §5 data-model.md).
        sa.CheckConstraint("public_key ~ '^pk_[0-9a-f]{32}$'", name="projects_key_fmt"),
        sa.CheckConstraint("cardinality(allowed_origins) <= 20", name="projects_origins_cnt"),
    )
    op.create_index("projects_public_key_key", "projects", ["public_key"], unique=True)
    op.create_index("projects_user_idx", "projects", ["user_id"])


def downgrade() -> None:
    op.drop_table("projects")
    op.drop_table("refresh_sessions")
    op.drop_table("users")
