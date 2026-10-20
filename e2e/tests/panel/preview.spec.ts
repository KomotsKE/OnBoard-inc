import { type APIRequestContext, type Page } from "@playwright/test";

import { asOwner, standProject } from "../../demo-api";
import { STAND_URL } from "../../urls";
import { expect, test } from "./owner-session";

/**
 * Предпросмотр тура на своём сайте (T5.6).
 *
 * Главное утверждение — отрицательное: проход владельца не оставляет следов
 * в аналитике. Поэтому смотрим и на сеть (ни одного запроса событий), и на
 * воронку тура после прохода.
 */

const TIP = '[data-part="tip"]';

async function tourWithStep(api: APIRequestContext): Promise<[string, string]> {
  const { id: projectId } = await standProject(api);
  const created = await api.post(`/v1/projects/${projectId}/tours`, {
    data: { name: "Сценарий превью", url_match: { mode: "exact", value: "/reports" } },
  });
  const { id: tourId } = (await created.json()) as { id: string };
  const step = await api.post(`/v1/tours/${tourId}/steps`, {
    data: { selector: '[data-testid="filters-button"]', title: "Фильтры", body: "Здесь фильтры" },
  });
  expect(step.ok(), await step.text()).toBeTruthy();
  return [projectId, tourId];
}

async function previewUrl(api: APIRequestContext, tourId: string): Promise<string> {
  const response = await api.post(`/v1/tours/${tourId}/editor-session`, {
    data: { page_url: `${STAND_URL}/reports`, mode: "preview" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { url: string }).url;
}

async function runsOf(api: APIRequestContext, tourId: string): Promise<number> {
  const response = await api.get(`/v1/tours/${tourId}/analytics?range=7d`);
  return ((await response.json()) as { totals: { runs: number } }).totals.runs;
}

test("проход тура в превью не пишет событий", async ({ owner, ownerContext }) => {
  const api = await asOwner();
  const [, tourId] = await tourWithStep(api);

  const site: Page = await ownerContext.newPage();
  const eventRequests: string[] = [];
  site.on("request", (request) => {
    if (request.url().includes("/v1/public/events")) {
      eventRequests.push(request.url());
    }
  });

  await site.goto(await previewUrl(api, tourId));

  // Тур проходится целиком — черновик виден, хотя он не опубликован.
  await expect(site.locator(TIP)).toBeVisible();
  await expect(site.locator('[data-part="title"]')).toHaveText("Фильтры");
  await site.getByRole("button", { name: "Готово" }).click();
  await expect(site.locator(TIP)).toHaveCount(0);
  await site.close();

  expect(eventRequests).toHaveLength(0);
  expect(await runsOf(api, tourId)).toBe(0);
  // Панель здесь только чтобы фикстура сессии владельца не простаивала впустую.
  expect(owner.url()).toBeTruthy();
});

test("«Превью» недоступно для тура без шагов", async ({ owner }) => {
  const api = await asOwner();
  const { id: projectId } = await standProject(api);
  const created = await api.post(`/v1/projects/${projectId}/tours`, {
    data: { name: "Сценарий превью: пустой" },
  });
  const { id: tourId } = (await created.json()) as { id: string };

  await owner.goto(`/projects/${projectId}/tours/${tourId}`);

  await expect(owner.getByTestId("preview")).toBeDisabled();
});
