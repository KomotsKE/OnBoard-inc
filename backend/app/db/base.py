"""Базовый класс моделей. Модели появляются вместе с сервисами, которые их
используют; метаданные нужны Alembic для autogenerate.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
