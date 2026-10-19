/** Туры проекта (S7 docs/screens.md). */

import { request } from "./client";

export type UrlMatch = {
  mode: "exact" | "contains" | "prefix" | "regex";
  value: string;
};

export type TourStatus = "draft" | "published" | "archived";

export type TourListItem = {
  id: string;
  name: string;
  status: TourStatus;
  url_match: UrlMatch;
  show_once: boolean;
  published_at: string | null;
  steps_count: number;
  /** Метрики приходят в том же ответе: иначе двадцать туров дали бы двадцать запросов. */
  runs_7d: number;
  completion_rate_7d: number;
};

type Page<T> = { items: T[]; next_cursor: string | null };

export async function listTours(projectId: string, signal?: AbortSignal): Promise<TourListItem[]> {
  const page = await request<Page<TourListItem>>(`/projects/${projectId}/tours`, { signal });
  return page.items;
}

export function createTour(projectId: string, name: string): Promise<TourListItem> {
  return request<TourListItem>(`/projects/${projectId}/tours`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** Публикация возвращает тур целиком, вместе со шагами. */
export function publishTour(id: string, published: boolean): Promise<Tour> {
  return request<Tour>(`/tours/${id}/${published ? "publish" : "unpublish"}`, {
    method: "POST",
  });
}

export function deleteTour(id: string): Promise<void> {
  return request<void>(`/tours/${id}`, { method: "DELETE" });
}

export type Step = {
  id: string;
  position: number;
  selector: string;
  title: string;
  body: string;
  placement: "auto" | "top" | "bottom" | "left" | "right";
};

/** Тур приходит вместе со шагами — одним запросом (S8 docs/screens.md). */
export type Tour = Omit<TourListItem, "steps_count" | "runs_7d" | "completion_rate_7d"> & {
  steps: Step[];
};

export type StepDraft = {
  selector: string;
  title: string;
  body: string;
  placement: Step["placement"];
};

export function getTour(id: string, signal?: AbortSignal): Promise<Tour> {
  return request<Tour>(`/tours/${id}`, { signal });
}

export function updateTour(
  id: string,
  patch: { name?: string; url_match?: UrlMatch; show_once?: boolean },
): Promise<Tour> {
  return request<Tour>(`/tours/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function createStep(tourId: string, step: StepDraft): Promise<Step> {
  return request<Step>(`/tours/${tourId}/steps`, {
    method: "POST",
    body: JSON.stringify(step),
  });
}

export function updateStep(id: string, patch: Partial<StepDraft>): Promise<Step> {
  return request<Step>(`/steps/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteStep(id: string): Promise<{ tour_status: TourStatus; steps_count: number }> {
  return request<{ tour_status: TourStatus; steps_count: number }>(`/steps/${id}`, {
    method: "DELETE",
  });
}

export function reorderSteps(tourId: string, stepIds: string[]): Promise<Step[]> {
  return request<Step[]>(`/tours/${tourId}/steps/order`, {
    method: "PUT",
    body: JSON.stringify({ step_ids: stepIds }),
  });
}
