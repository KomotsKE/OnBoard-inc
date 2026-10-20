import { expect, test, type APIRequestContext } from "@playwright/test";

import { asOwner, standProject } from "../../demo-api";
import { STAND_URL } from "../../urls";

/**
 * Режим редактора на стенде (T5.4).
 *
 * Токен берётся там же, где его возьмёт панель, — у `editor-session`. Тур
 * создаётся свой: сценарий добавляет в него шаги, а демо-туры читают другие
 * сценарии.
 */

const PANEL = '[data-part="panel"]';

type Step = { selector: string; title: string; body: string };

async function tourWithToken(api: APIRequestContext, name: string): Promise<[string, string]> {
  const { id: projectId } = await standProject(api);
  const tour = await api.post(`/v1/projects/${projectId}/tours`, { data: { name } });
  const { id } = (await tour.json()) as { id: string };
  const session = await api.post(`/v1/tours/${id}/editor-session`, {
    data: { page_url: `${STAND_URL}/reports`, mode: "edit" },
  });
  expect(session.ok(), await session.text()).toBeTruthy();
  const { url } = (await session.json()) as { url: string };
  return [id, url.split("onboard_edit=")[1]];
}

async function stepsOf(api: APIRequestContext, tourId: string): Promise<Step[]> {
  const response = await api.get(`/v1/tours/${tourId}`);
  return ((await response.json()) as { steps: Step[] }).steps;
}

test("клик по элементу стенда создаёт шаг с рабочим селектором", async ({ page }) => {
  const api = await asOwner();
  const [tourId, token] = await tourWithToken(api, "Сценарий редактора");

  await page.goto(`/reports?onboard_edit=${token}`);
  await expect(page.locator(PANEL)).toBeVisible();

  // Кнопка сайта: клик обязан выбрать её, а не нажать.
  await page.getByTestId("filters-button").click();
  await expect(page.locator('[data-part="selector"]')).toHaveText('[data-testid="filters-button"]');
  await page.locator('[data-part="step-body"]').fill("Здесь настраиваются фильтры");
  await page.locator('[data-part="step-title"]').fill("Фильтры");
  await page.getByRole("button", { name: "Добавить шаг" }).click();

  await expect(page.locator('[data-part="step"]')).toHaveText("Фильтры — Здесь настраиваются фильтры");

  const steps = await stepsOf(api, tourId);
  expect(steps).toHaveLength(1);
  expect(steps[0].title).toBe("Фильтры");
  // Селектор обязан быть рабочим на той же странице, а не просто непустым.
  const found = await page.locator(steps[0].selector).count();
  expect(found).toBe(1);
});

test("выбор ссылки не уводит со страницы", async ({ page }) => {
  const api = await asOwner();
  const [, token] = await tourWithToken(api, "Сценарий редактора: ссылка");

  await page.goto(`/reports?onboard_edit=${token}`);
  await expect(page.locator(PANEL)).toBeVisible();

  await page.getByTestId("nav-dashboard").click();

  // Стенд на загрузке срезает query своим replaceState, поэтому сверяем путь:
  // важно, что клик по ссылке не увёл на /dashboard.
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.locator('[data-part="form"]')).toBeVisible();
});

test("кнопка «Готово» убирает редактор со страницы", async ({ page }) => {
  const api = await asOwner();
  const [, token] = await tourWithToken(api, "Сценарий редактора: выход");

  await page.goto(`/reports?onboard_edit=${token}`);
  await expect(page.locator(PANEL)).toBeVisible();

  await page.getByRole("button", { name: "Готово" }).click();

  await expect(page.locator('[data-onboard="editor"]')).toHaveCount(0);
});

test("без валидного токена режим редактора не запускается", async ({ page }) => {
  await page.goto("/reports?onboard_edit=не-токен");

  await expect(page.locator('[data-onboard="editor"]')).toHaveCount(0);
  // И тур тоже не показывается: страница открыта не для посетителя.
  await expect(page.locator('[data-part="tip"]')).toHaveCount(0);
});
