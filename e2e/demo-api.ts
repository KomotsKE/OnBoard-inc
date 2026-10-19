/**
 * Вызовы API от имени демо-владельца.
 *
 * Нужны сценариям, которые проверяют не панель, а последствия её действий:
 * например, что виджет на стенде подхватил изменённую тему. Ходить ради
 * этого через интерфейс — значит проверять панель там, где проверяется виджет.
 */

import { request, type APIRequestContext } from "@playwright/test";

import { DEMO_EMAIL, DEMO_PASSWORD } from "./tests/panel/demo-owner";
import { API_URL } from "./urls";

/** Ключ демо-проекта: он же стоит в сниппете стенда. */
export const STAND_KEY = "pk_00000000000000000000000000000001";

export type Theme = Record<string, string | number>;

export async function asOwner(): Promise<APIRequestContext> {
  const context = await request.newContext({ baseURL: API_URL });
  const response = await context.post("/v1/auth/login", {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  const { access_token } = (await response.json()) as { access_token: string };
  return request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${access_token}` },
  });
}

export async function standProject(api: APIRequestContext): Promise<{ id: string; theme: Theme }> {
  const response = await api.get("/v1/projects");
  const { items } = (await response.json()) as { items: { id: string; public_key: string; theme: Theme }[] };
  const project = items.find((item) => item.public_key === STAND_KEY);
  if (!project) {
    throw new Error("демо-проект стенда не найден — выполните make seed");
  }
  return { id: project.id, theme: project.theme };
}

export async function setTheme(
  api: APIRequestContext,
  projectId: string,
  theme: Theme,
): Promise<void> {
  const response = await api.patch(`/v1/projects/${projectId}`, { data: { theme } });
  if (!response.ok()) {
    throw new Error(`тема не сохранилась: ${response.status()} ${await response.text()}`);
  }
}
