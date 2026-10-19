"""Маршруты проектов. Доступ только через `OwnedProject`: прямой
`session.get(Project, id)` в обработчиках панели запрещён (§12 conventions)."""

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, OwnedProject, PanelSession, SettingsDep
from app.core.logging import log_event
from app.schemas.projects import (
    Page,
    ProjectCreate,
    ProjectRead,
    ProjectUpdate,
    SnippetResponse,
    Theme,
)
from app.services import projects as service

router = APIRouter(prefix="/v1/projects", tags=["projects"])


def _read(project, tours_count: int) -> ProjectRead:  # noqa: ANN001 — модель SQLAlchemy
    return ProjectRead(
        id=str(project.id),
        name=project.name,
        public_key=project.public_key,
        allowed_origins=list(project.allowed_origins),
        theme=Theme(**project.theme),
        # Панель показывает статус подключения, а не саму метку времени:
        # владельцу важно «виджет найден», а не когда именно.
        widget_connected=project.widget_last_seen_at is not None,
        tours_count=tours_count,
        created_at=project.created_at.isoformat(),
    )


@router.get("", response_model=Page[ProjectRead])
async def list_projects(user: CurrentUser, session: PanelSession) -> Page[ProjectRead]:
    rows = await service.list_for_user(session, user.id)
    return Page(items=[_read(project, tours_count) for project, tours_count in rows])


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate, user: CurrentUser, session: PanelSession
) -> ProjectRead:
    project = await service.create(session, user.id, body.name)
    log_event("project.created", user_id=str(user.id), project_id=str(project.id))
    return _read(project, 0)


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(project: OwnedProject, session: PanelSession) -> ProjectRead:
    return _read(project, await service.count_tours(session, project.id))


@router.patch("/{project_id}", response_model=ProjectRead)
async def update_project(
    body: ProjectUpdate, project: OwnedProject, session: PanelSession
) -> ProjectRead:
    updated = await service.update(
        session,
        project,
        name=body.name,
        allowed_origins=body.allowed_origins,
        theme=body.theme,
    )
    log_event("project.updated", project_id=str(updated.id))
    return _read(updated, await service.count_tours(session, updated.id))


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project: OwnedProject, session: PanelSession) -> None:
    project_id = str(project.id)
    await service.delete(session, project)
    log_event("project.deleted", project_id=project_id)


@router.get("/{project_id}/snippet", response_model=SnippetResponse)
async def project_snippet(project: OwnedProject, settings: SettingsDep) -> SnippetResponse:
    return SnippetResponse(snippet=service.snippet_for(settings, project))
