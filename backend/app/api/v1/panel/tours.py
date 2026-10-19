"""Маршруты туров.

Тур доступен только через `OwnedTour`: зависимость проверяет и владельца
проекта, и принадлежность тура этому проекту (ADR-0006).
"""

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.core.deps import OwnedProject, OwnedTour, PanelSession
from app.core.logging import log_event
from app.models import Tour
from app.schemas.analytics import Range, TourAnalytics
from app.schemas.projects import Page
from app.schemas.tours import StepRead, TourCreate, TourListItem, TourRead, TourUpdate, UrlMatch
from app.services import analytics as analytics_service
from app.services import tours as service

router = APIRouter(tags=["tours"])


def _match(tour: Tour) -> UrlMatch:
    return UrlMatch(mode=tour.url_match_mode, value=tour.url_match_value)


def _read(tour: Tour) -> TourRead:
    return TourRead(
        id=str(tour.id),
        name=tour.name,
        status=tour.status,
        url_match=_match(tour),
        show_once=tour.show_once,
        published_at=tour.published_at.isoformat() if tour.published_at else None,
        steps=[
            StepRead(
                id=str(step.id),
                position=step.position,
                selector=step.selector,
                title=step.title,
                body=step.body,
                placement=step.placement,
            )
            for step in tour.steps
        ],
    )


@router.get("/v1/projects/{project_id}/tours", response_model=Page[TourListItem])
async def list_tours(project: OwnedProject, session: PanelSession) -> Page[TourListItem]:
    rows = await service.list_with_metrics(session, project.id)
    return Page(
        items=[
            TourListItem(
                id=str(tour.id),
                name=tour.name,
                status=tour.status,
                url_match=_match(tour),
                show_once=tour.show_once,
                published_at=tour.published_at.isoformat() if tour.published_at else None,
                steps_count=steps_count,
                runs_7d=runs,
                completion_rate_7d=round(completed / runs, 4) if runs else 0.0,
            )
            for tour, steps_count, runs, completed in rows
        ]
    )


@router.post(
    "/v1/projects/{project_id}/tours",
    response_model=TourRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_tour(body: TourCreate, project: OwnedProject, session: PanelSession) -> TourRead:
    tour = await service.create(
        session,
        project.id,
        name=body.name,
        url_match=body.url_match,
        show_once=body.show_once,
    )
    log_event("tour.created", project_id=str(project.id), tour_id=str(tour.id))
    return _read(tour)


@router.get("/v1/tours/{tour_id}", response_model=TourRead)
async def get_tour(tour: OwnedTour) -> TourRead:
    return _read(tour)


@router.patch("/v1/tours/{tour_id}", response_model=TourRead)
async def update_tour(body: TourUpdate, tour: OwnedTour, session: PanelSession) -> TourRead:
    updated = await service.update(
        session,
        tour,
        name=body.name,
        url_match=body.url_match,
        show_once=body.show_once,
    )
    log_event("tour.updated", tour_id=str(updated.id))
    return _read(updated)


@router.delete("/v1/tours/{tour_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tour(tour: OwnedTour, session: PanelSession) -> None:
    tour_id = str(tour.id)
    await service.delete(session, tour)
    log_event("tour.deleted", tour_id=tour_id)


@router.post("/v1/tours/{tour_id}/publish", response_model=TourRead)
async def publish_tour(tour: OwnedTour, session: PanelSession) -> TourRead:
    previous = tour.status
    published = await service.publish(session, tour)
    log_event("tour.published", tour_id=str(published.id), previous_status=previous)
    return _read(published)


@router.post("/v1/tours/{tour_id}/unpublish", response_model=TourRead)
async def unpublish_tour(tour: OwnedTour, session: PanelSession) -> TourRead:
    previous = tour.status
    draft = await service.unpublish(session, tour)
    log_event("tour.unpublished", tour_id=str(draft.id), previous_status=previous)
    return _read(draft)


@router.get("/v1/tours/{tour_id}/analytics", response_model=TourAnalytics)
async def tour_analytics(
    tour: OwnedTour,
    session: PanelSession,
    range: Annotated[Range, Query()] = "7d",
) -> TourAnalytics:
    """Воронка тура за скользящее окно (§7.2 docs/vision.md)."""
    return await analytics_service.tour_analytics(session, tour, range)
