import { type Page } from "@playwright/test";

import { expect, test } from "./owner-session";
import { chooseInMenu } from "./tour-menu";

/**
 * Экран воронки (T4.4).
 *
 * Цифры на экране не выдумываются сценарием: они сверяются с тем, что отдаёт
 * API того же тура. Абсолютные значения проверять нельзя — сценарии виджета
 * проходят демо-тур по-настоящему и честно добавляют прогоны.
 */

async function openAnalytics(page: Page, tour: string): Promise<void> {
  await page.goto("/projects");
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: "Отчётница" });
  await card.getByRole("link", { name: "Туры", exact: true }).click();
  const row = page.locator('[data-testid="tour-row"]').filter({ hasText: tour });
  await chooseInMenu(page, row, "link", "Аналитика");
}

test("воронка показывает те же числа, что отдаёт API", async ({ owner: page }) => {
  const response = page.waitForResponse((reply) => reply.url().includes("/analytics?range=7d"));
  await openAnalytics(page, "Знакомство");
  const data = await (await response).json();

  const totals = page.getByTestId("totals");
  await expect(totals).toContainText(String(data.totals.runs));
  await expect(totals).toContainText(String(data.totals.completed));

  // Каждому шагу тура — своя строка воронки, плюс строка «Завершили».
  await expect(page.getByTestId("funnel").locator("li")).toHaveCount(data.funnel.length + 1);
  await expect(page.getByTestId("funnel")).toContainText(`${data.funnel[0].runs} · 100 %`);
});

test("шаги воронки идут в порядке тура", async ({ owner: page }) => {
  const response = page.waitForResponse((reply) => reply.url().includes("/analytics?range=7d"));
  await openAnalytics(page, "Знакомство");
  const data = await (await response).json();

  const names = await page.getByTestId("funnel").locator(".funnel__name").allTextContents();
  const expected = data.funnel.map(
    (step: { step_position: number; title: string }) => `${step.step_position + 1}. ${step.title}`,
  );
  expect(names).toEqual([...expected, "Завершили"]);
});

test("при наличии проблем воронка и проблемы стоят на общей сетке", async ({ owner: page }) => {
  await page.route("**/analytics?range=7d", async (route) => {
    const reply = await route.fetch();
    const data = await reply.json();
    const issue = { type: "step_target_missing", step_position: 0, selector: "#x", error_code: null, count: 2 };
    await route.fulfill({ response: reply, json: { ...data, issues: [issue] } });
  });
  await openAnalytics(page, "Знакомство");

  const split = page.getByTestId("analytics-split");
  await expect(split).toHaveCount(1);
  await expect(split.getByTestId("funnel")).toBeVisible();
  await expect(split.getByTestId("issues")).toBeVisible();
  // Блок «Проблемы» не должен попасть внутрь воронки.
  await expect(page.getByTestId("funnel").getByTestId("issues")).toHaveCount(0);
});

test("без проблем воронка занимает всю ширину, без двухколоночной сетки", async ({ owner: page }) => {
  // Подменяем ответ: тот же тур, но список проблем пуст.
  await page.route("**/analytics?range=7d", async (route) => {
    const reply = await route.fetch();
    const data = await reply.json();
    await route.fulfill({ response: reply, json: { ...data, issues: [] } });
  });
  await openAnalytics(page, "Знакомство");

  await expect(page.getByTestId("funnel")).toBeVisible();
  await expect(page.getByTestId("issues")).toHaveCount(0);
  await expect(page.getByTestId("analytics-split")).toHaveCount(0);
});

test("худший шаг подсвечен и подписан, а не только раскрашен", async ({ owner: page }) => {
  await openAnalytics(page, "Знакомство");

  // Статусный цвет никогда не работает в одиночку: рядом знак и текст.
  const flag = page.getByTestId("problem-step");
  await expect(flag).toBeVisible();
  await expect(flag).toContainText("Здесь теряется больше всего");
});

test("переключатель периода перезапрашивает данные", async ({ owner: page }) => {
  await openAnalytics(page, "Знакомство");

  const response = page.waitForResponse((reply) => reply.url().includes("/analytics?range=30d"));
  await page.getByTestId("range-30d").click();
  await expect(await response).toBeTruthy();

  await expect(page.getByTestId("range-30d")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("range-7d")).toHaveAttribute("aria-pressed", "false");
});

test("тур без прогонов объясняет, что проверить", async ({ owner: page }) => {
  // Черновик из make seed: его никто не проходил.
  await openAnalytics(page, "Черновик для проверки");

  await expect(page.getByTestId("funnel-empty")).toContainText("Тур ещё не запускали");
  await expect(page.getByTestId("funnel-empty")).toContainText("условие показа");
});
