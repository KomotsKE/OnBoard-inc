"""Туры и шаги

Миграция 002 из §3.2 docs/data-model.md.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tours",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'draft'")),
        # Условие показа разложено на две колонки, а не хранится в JSONB:
        # по нему идёт отбор тура в самом горячем запросе /public/config.
        sa.Column(
            "url_match_mode", sa.Text(), nullable=False, server_default=sa.text("'contains'")
        ),
        sa.Column("url_match_value", sa.Text(), nullable=False, server_default=sa.text("'/'")),
        sa.Column("show_once", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("status IN ('draft', 'published', 'archived')", name="tours_status_chk"),
        sa.CheckConstraint(
            "url_match_mode IN ('exact', 'contains', 'prefix', 'regex')", name="tours_match_mode"
        ),
        sa.CheckConstraint(
            "char_length(url_match_value) BETWEEN 1 AND 500", name="tours_match_val_len"
        ),
        # Опубликованный тур всегда имеет дату публикации; архивный её сохраняет.
        sa.CheckConstraint(
            "status <> 'published' OR published_at IS NOT NULL", name="tours_published_ts"
        ),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 200", name="tours_name_len"),
    )
    op.create_index("tours_project_status_idx", "tours", ["project_id", "status"])

    op.create_table(
        "steps",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tour_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tours.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("selector", sa.Text(), nullable=False),
        sa.Column(
            "selector_candidates",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("title", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("placement", sa.Text(), nullable=False, server_default=sa.text("'auto'")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("position BETWEEN 0 AND 199", name="steps_position_rng"),
        sa.CheckConstraint("char_length(selector) BETWEEN 1 AND 500", name="steps_selector_len"),
        sa.CheckConstraint("char_length(title) <= 200", name="steps_title_len"),
        sa.CheckConstraint("char_length(body) BETWEEN 1 AND 2000", name="steps_body_len"),
        sa.CheckConstraint(
            "placement IN ('auto', 'top', 'bottom', 'left', 'right')", name="steps_placement_chk"
        ),
        sa.CheckConstraint("cardinality(selector_candidates) <= 5", name="steps_cand_cnt"),
        # DEFERRABLE переносит проверку на конец оператора: перестановка шагов
        # одним UPDATE проходит через состояние с одинаковыми позициями.
        sa.UniqueConstraint(
            "tour_id",
            "position",
            name="steps_tour_position_key",
            deferrable=True,
            initially="IMMEDIATE",
        ),
    )


def downgrade() -> None:
    op.drop_table("steps")
    op.drop_table("tours")
