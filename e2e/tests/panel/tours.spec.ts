import { type Page } from "@playwright/test";

import { expect, test } from "./owner-session";

/**
 * Список туров (T3.4).
 *
 * Главное утверждение: опубликованный в панели тур немедленно виден виджету.
 * Проверяется запросом конфига со страницы стенда — тем же, который делает
 * загрузчик.
 *
 * Публикация проверяется на черновике из `make seed`, который не трогают
 * сценарии виджета: иначе результат зависел бы от порядка запуска.
 */

import { API_URL as API, STAND_URL as STAND } from "../../urls";
const DRAFT = "Черновик для проверки";

async function openTours(page: Page): Promise<void> {
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: "Отчётница" });
  await card.getByRole("link", { name: "Туры", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Туры" })).toBeVisible();
}

/** Что отдаёт конфиг виджета для адреса: имя тура или «нет тура». */
async function tourForPage(page: Page, path: string): Promise<string> {
  const stand = await page.context().newPage();
  await stand.goto(`${STAND}/settings`);
  const name = await stand.evaluate(
    async ([api, url]) => {
      const response = await fetch(
        `${api}/v1/public/config?key=pk_00000000000000000000000000000001&url=${encodeURIComponent(url)}`,
        // Конфиг отдаётся с max-age=60: виджету это экономит запросы, а проверке
        // подсунуло бы ответ, снятый до публикации.
        { cache: "no-store" },
      );
      const body = (await response.json()) as { tour: { name: string } | null };
      return body.tour?.name ?? "нет тура";
    },
    [API, path] as const,
  );
  await stand.close();
  return name;
}

test("публикация делает тур видимым виджету, снятие — скрывает", async ({ owner: page }) => {
  await page.goto("/projects");
  await openTours(page);
  const row = page.locator('[data-testid="tour-row"]').filter({ hasText: DRAFT });

  await expect(row).toContainText("Черновик");
  expect(await tourForPage(page, "/panel-check")).toBe("нет тура");

  await row.getByRole("button", { name: "Опубликовать" }).click();
  await expect(row).toContainText("Опубликован");

  expect(await tourForPage(page, "/panel-check")).toBe(DRAFT);

  // Возвращаем как было: демо-данные общие для всех сценариев.
  await row.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(row).toContainText("Черновик");
  expect(await tourForPage(page, "/panel-check")).toBe("нет тура");
});

test("список показывает запуски и долю дошедших до конца за 7 дней", async ({ owner: page }) => {
  await page.goto("/projects");
  await openTours(page);

  // Демо-данные: 20 прогонов, 12 завершений (см. make seed).
  const row = page.locator('[data-testid="tour-row"]').filter({ hasText: "Знакомство" });
  await expect(row.getByTestId("tour-metrics")).toHaveText(
    "20 запусков за 7 дней, дошли до конца 60 %",
  );
  await expect(row).toContainText("адрес начинается с «/reports»");
});

test("тур без шагов опубликовать нельзя, и видно почему", async ({ owner: page }) => {
  const name = `Пустой ${Date.now().toString().slice(-6)}`;
  await page.goto("/projects");
  await openTours(page);

  await page.getByLabel("Название нового тура").fill(name);
  await page.getByRole("button", { name: "Создать" }).click();

  const row = page.locator('[data-testid="tour-row"]').filter({ hasText: name });
  await expect(row).toContainText("0 шагов");
  await expect(row.getByRole("button", { name: "Опубликовать" })).toBeDisabled();
  await expect(row.getByTestId("tour-no-steps")).toBeVisible();

  // Прибираем за собой.
  await row.getByRole("button", { name: "Удалить" }).click();
  await row.getByTestId("tour-confirm").getByRole("button", { name: "Удалить" }).click();
  await expect(row).toHaveCount(0);
});
