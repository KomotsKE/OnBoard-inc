"""Маршруты шагов тура."""

from fastapi import APIRouter, status

from app.core.deps import OwnedStep, OwnedTour, PanelSession
from app.core.logging import log_event
from app.models import Step
from app.schemas.tours import (
    StepCreate,
    StepDeleted,
    StepRead,
    StepsOrder,
    StepUpdate,
)
from app.services import steps as service

router = APIRouter(tags=["steps"])


def _read(step: Step) -> StepRead:
    return StepRead(
        id=str(step.id),
        position=step.position,
        selector=step.selector,
        title=step.title,
        body=step.body,
        placement=step.placement,
    )


@router.post(
    "/v1/tours/{tour_id}/steps", response_model=StepRead, status_code=status.HTTP_201_CREATED
)
async def create_step(body: StepCreate, tour: OwnedTour, session: PanelSession) -> StepRead:
    step = await service.create(
        session,
        tour,
        selector=body.selector,
        body=body.body,
        title=body.title,
        placement=body.placement,
    )
    log_event("step.created", tour_id=str(tour.id), step_id=str(step.id))
    return _read(step)


@router.patch("/v1/steps/{step_id}", response_model=StepRead)
async def update_step(body: StepUpdate, step: OwnedStep, session: PanelSession) -> StepRead:
    updated = await service.update_step(
        session,
        step,
        selector=body.selector,
        body=body.body,
        title=body.title,
        placement=body.placement,
    )
    log_event("step.updated", tour_id=str(updated.tour_id), step_id=str(updated.id))
    return _read(updated)


@router.delete("/v1/steps/{step_id}", response_model=StepDeleted)
async def delete_step(step: OwnedStep, session: PanelSession) -> StepDeleted:
    step_id = str(step.id)
    tour, remaining = await service.delete(session, step)

    log_event("step.deleted", tour_id=str(tour.id), step_id=step_id)
    if remaining == 0 and tour.status == "draft":
        log_event("tour.auto_unpublished", level=30, tour_id=str(tour.id))

    return StepDeleted(tour_id=str(tour.id), tour_status=tour.status, steps_count=remaining)


@router.put("/v1/tours/{tour_id}/steps/order", response_model=list[StepRead])
async def reorder_steps(body: StepsOrder, tour: OwnedTour, session: PanelSession) -> list[StepRead]:
    steps = await service.reorder(session, tour, list(body.step_ids))
    log_event("steps.reordered", tour_id=str(tour.id), count=len(steps))
    return [_read(step) for step in steps]
