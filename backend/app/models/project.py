"""Проект — сайт клиента: ключ для виджета, разрешённые домены, оформление."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ARRAY, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.user import User


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        Index("projects_public_key_key", "public_key", unique=True),
        Index("projects_user_idx", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    # Пустой список = ни один домен не разрешён: виджет не работает, пока
    # владелец не добавит домен (fail closed, §8.1 docs/vision.md).
    allowed_origins: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=func.text("'{}'::text[]")
    )
    theme: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    widget_last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="projects")
