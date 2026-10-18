"""Событие прохождения тура — обезличенная телеметрия (§1 docs/data-model.md)."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Identity, Index, SmallInteger, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        Index("events_event_id_key", "event_id", unique=True),
        Index("events_tour_created_idx", "tour_id", "created_at"),
        Index("events_project_created_idx", "project_id", "created_at"),
    )

    # Последовательный ключ, а не UUID: случайные ключи разносят B-дерево
    # таблицы с миллионами вставок (§4 docs/data-model.md).
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    tour_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tours.id", ondelete="CASCADE")
    )
    step_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("steps.id", ondelete="SET NULL")
    )
    # Денормализация: позиция на момент события — исторический факт, который
    # не должен меняться вслед за правкой тура.
    step_position: Mapped[int | None] = mapped_column(SmallInteger)
    run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    visitor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    type: Mapped[str] = mapped_column(Text, nullable=False)
    url_path: Mapped[str | None] = mapped_column(Text)
    device: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
