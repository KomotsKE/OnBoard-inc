import { type Page } from "@playwright/test";

import { STAND_URL } from "../../urls";
import { expect, test } from "./owner-session";

/**
 * Экран оформления (T6.2).
 *
 * Главное утверждение: смена цвета в панели доезжает до сайта клиента без
 * переустановки сниппета. Проверяется на стенде — тем же виджетом, который
 * стоит у клиента.
 */

const BRAND = "#7c3aed";
const DEFAULT_BRAND = "#2563eb";

async function openBranding(page: Page): Promise<void> {
  await page.goto("/projects");
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: "Отчётница" });
  await card.getByRole("link", { name: "Туры", exact: true }).click();
  // Адрес экрана брендинга лежит внутри проекта; идём по нему напрямую.
  const url = new URL(page.url());
  await page.goto(`${url.pathname.replace(/\/tours$/, "")}/branding`);
  await expect(page.getByTestId("branding-form")).toBeVisible();
}

async function setBrandColor(page: Page, color: string): Promise<void> {
  await page.getByLabel("Основной цвет").fill(color);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("button", { name: "Сохранено" })).toBeVisible();
}

test("смена цвета видна на стенде без переустановки сниппета", async ({ owner: page }) => {
  await openBranding(page);

  try {
    await setBrandColor(page, BRAND);

    const stand = await page.context().newPage();
    await stand.goto(`${STAND_URL}/reports`);
    await expect(stand.locator('[data-part="tip"]')).toBeVisible();

    // Рамка подсветки — новым цветом. Сниппет на стенде не менялся.
    expect(await stand.locator('[data-part="ring-inner"]').getAttribute("stroke")).toBe(BRAND);
    await stand.close();
  } finally {
    await setBrandColor(page, DEFAULT_BRAND);
  }
});

test("превью меняется сразу, до сохранения", async ({ owner: page }) => {
  await openBranding(page);

  const preview = page.getByTestId("preview");
  await page.getByLabel("Кнопка «дальше»").fill("Поехали");

  // Владелец подбирает подписи и цвета, видя результат, а не сохраняя каждый
  // вариант ради проверки.
  await expect(preview).toContainText("Поехали");
  await expect(page.getByRole("button", { name: "Сохранить" })).toBeEnabled();

  // Ничего не сохраняли — «вернуть как было» возвращает тему проекта.
  await page.getByRole("button", { name: "Вернуть как было" }).click();
  await expect(preview).toContainText("Далее");
});

test("превью рисуется цветом проекта", async ({ owner: page }) => {
  await openBranding(page);

  await page.getByLabel("Основной цвет").fill(BRAND);

  const button = page.getByTestId("preview").locator(".preview__primary");
  await expect(button).toHaveCSS("background-color", "rgb(124, 58, 237)");
});
