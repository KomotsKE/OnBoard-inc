"""Тур и его шаги."""

import uuid
from datetime import datetime

from sqlalchemy import (
    ARRAY,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.project import Project


class Tour(Base):
    __tablename__ = "tours"
    __table_args__ = (Index("tours_project_status_idx", "project_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=func.text("'draft'"))
    url_match_mode: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=func.text("'contains'")
    )
    url_match_value: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=func.text("'/'")
    )
    show_once: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=func.text("true")
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="tours")
    steps: Mapped[list["Step"]] = relationship(
        back_populates="tour",
        cascade="all, delete-orphan",
        order_by="Step.position",
    )


class Step(Base):
    __tablename__ = "steps"
    __table_args__ = (
        UniqueConstraint(
            "tour_id",
            "position",
            name="steps_tour_position_key",
            deferrable=True,
            initially="IMMEDIATE",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tour_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tours.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    selector: Mapped[str] = mapped_column(Text, nullable=False)
    # Задел на самовосстановление селекторов (§12 docs/vision.md).
    selector_candidates: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=func.text("'{}'::text[]")
    )
    title: Mapped[str] = mapped_column(Text, nullable=False, server_default=func.text("''"))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    placement: Mapped[str] = mapped_column(Text, nullable=False, server_default=func.text("'auto'"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    tour: Mapped[Tour] = relationship(back_populates="steps")
