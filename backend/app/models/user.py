"""Владелец сайта — клиент платформы. Единственные персональные данные в системе
(§1 docs/data-model.md).
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    # Индексы объявлены так же, как в миграции 001: имена должны совпадать,
    # иначе `alembic check` видит расхождение модели и схемы.
    __table_args__ = (Index("users_email_key", "email", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    # Хранится в нижнем регистре: приведение гарантирует и сервис, и CHECK в БД.
    email: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    sessions: Mapped[list["RefreshSession"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
    projects: Mapped[list["Project"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
