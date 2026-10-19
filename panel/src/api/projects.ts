/** Проекты владельца (S4 docs/screens.md). */

import { request } from "./client";

export type Project = {
  id: string;
  name: string;
  public_key: string;
  allowed_origins: string[];
  theme: Record<string, string | number>;
  /** Виджет хотя бы раз запрашивал конфиг этого проекта. */
  widget_connected: boolean;
  tours_count: number;
  created_at: string;
};

/** Конверт списковых ответов — §12.8 docs/conventions.md. */
type Page<T> = { items: T[]; next_cursor: string | null };

/**
 * `signal` приходит от TanStack Query и обязан доехать до `fetch`: без него
 * отменённый запрос продолжает жить и его поздний ответ перезаписывает кэш
 * свежими данными наоборот — старыми (§5 docs/conventions.md).
 */
export async function listProjects(signal?: AbortSignal): Promise<Project[]> {
  const page = await request<Page<Project>>("/projects", { signal });
  return page.items;
}

export function createProject(name: string): Promise<Project> {
  return request<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) });
}

export function deleteProject(id: string): Promise<void> {
  return request<void>(`/projects/${id}`, { method: "DELETE" });
}

export function getProject(id: string, signal?: AbortSignal): Promise<Project> {
  return request<Project>(`/projects/${id}`, { signal });
}

export async function getSnippet(id: string, signal?: AbortSignal): Promise<string> {
  const response = await request<{ snippet: string }>(`/projects/${id}/snippet`, { signal });
  return response.snippet;
}

export function setAllowedOrigins(id: string, origins: string[]): Promise<Project> {
  return request<Project>(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ allowed_origins: origins }),
  });
}
