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

export function publishTour(id: string, published: boolean): Promise<TourListItem> {
  return request<TourListItem>(`/tours/${id}/${published ? "publish" : "unpublish"}`, {
    method: "POST",
  });
}

export function deleteTour(id: string): Promise<void> {
  return request<void>(`/tours/${id}`, { method: "DELETE" });
}
