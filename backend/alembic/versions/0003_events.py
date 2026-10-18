"""События аналитики

Миграция 003 из §3.3 docs/data-model.md. Таблица создаётся уже в T1.4, потому
что список туров отдаёт метрики за 7 дней одним агрегатом по ней; приём событий
появится в T4.1.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EVENT_TYPES = (
    "tour_started",
    "step_viewed",
    "step_back",
    "tour_skipped",
    "tour_completed",
    "step_target_missing",
    "widget_error",
    "widget_ping",
)


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        # Генерирует клиент: уникальный индекс даёт идемпотентность приёма.
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tour_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tours.id", ondelete="CASCADE"),
        ),
        # Шаг удаляют, а воронка за прошлый период должна остаться считаемой,
        # поэтому связь обнуляется, а позиция сохраняется как исторический факт.
        sa.Column(
            "step_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("steps.id", ondelete="SET NULL"),
        ),
        sa.Column("step_position", sa.SmallInteger()),
        sa.Column("run_id", postgresql.UUID(as_uuid=True)),
        sa.Column("visitor_id", postgresql.UUID(as_uuid=True)),
        sa.Column("type", sa.Text(), nullable=False),
        # Только path, без query: в параметрах встречаются токены и email.
        sa.Column("url_path", sa.Text()),
        sa.Column("device", sa.Text()),
        sa.Column("error_code", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "type IN (" + ", ".join(f"'{name}'" for name in EVENT_TYPES) + ")",
            name="events_type_chk",
        ),
        sa.CheckConstraint(
            "device IS NULL OR device IN ('desktop', 'mobile', 'tablet')",
            name="events_device_chk",
        ),
        sa.CheckConstraint(
            "url_path IS NULL OR char_length(url_path) <= 200", name="events_url_len"
        ),
        sa.CheckConstraint(
            "step_position IS NULL OR step_position BETWEEN 0 AND 199", name="events_pos_rng"
        ),
    )
    op.create_index("events_event_id_key", "events", ["event_id"], unique=True)
    op.create_index("events_tour_created_idx", "events", ["tour_id", "created_at"])
    op.create_index("events_project_created_idx", "events", ["project_id", "created_at"])


def downgrade() -> None:
    op.drop_table("events")
