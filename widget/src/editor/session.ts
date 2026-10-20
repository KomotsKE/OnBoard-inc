/**
 * Обращения редактора к API: всё, что идёт по токену сессии (ADR-0004).
 *
 * Отдельно от UI, потому что здесь единственное место, которое знает про
 * формат ответов, и единственное, которое ходит в сеть.
 */

import { report } from "../core/guard";

/** Тот же предел, что у конфига: редактор не ждёт дольше, чем тур. */
const TIMEOUT_MS = 3000;

export type EditorStep = {
  id: string;
  position: number;
  selector: string;
  title: string;
  body: string;
  placement: string;
};

export type EditorState = {
  mode: "edit" | "preview";
  editor_url: string;
  tour: { id: string; name: string };
  steps: EditorStep[];
  theme: Record<string, string | number>;
};

export type StepDraft = { selector: string; title: string; body: string };

async function send<T>(url: string, init: RequestInit): Promise<T | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: abort.signal, credentials: "omit" });
    if (!response.ok) {
      report("editor_request_failed", response.status);
      return null;
    }
    return response.status === 204 ? (null as T) : ((await response.json()) as T);
  } catch (error) {
    report("editor_request_failed", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function readSession(apiUrl: string, token: string): Promise<EditorState | null> {
  const params = new URLSearchParams({ token });
  return send<EditorState>(`${apiUrl}/v1/public/editor/session?${params.toString()}`, {
    method: "GET",
  });
}

export function createStep(
  apiUrl: string,
  token: string,
  step: StepDraft,
): Promise<EditorStep | null> {
  return send<EditorStep>(`${apiUrl}/v1/public/editor/steps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, step: { ...step, placement: "auto" } }),
  });
}
