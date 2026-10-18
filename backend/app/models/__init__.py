"""Модели регистрируются здесь, иначе Alembic не увидит их в метаданных."""

from app.models.event import Event
from app.models.project import Project
from app.models.refresh_session import RefreshSession
from app.models.tour import Step, Tour
from app.models.user import User

__all__ = ["Event", "Project", "RefreshSession", "Step", "Tour", "User"]
