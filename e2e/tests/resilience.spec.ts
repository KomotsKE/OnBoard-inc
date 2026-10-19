import { expect, test, type Page } from "@playwright/test";

/**
 * Защитный контур (T2.8).
 *
 * Главное свойство виджета на чужом сайте — не сломать его. Здесь проверяется
 * именно это: при недоступном API, при испорченном тексте шага и просто по
 * факту присутствия виджет не оставляет на странице ни необработанных ошибок,
 * ни лишних глобалов.
 */

const HOST = '[data-onboard="host"]';
const TIP = '[data-part="tip"]';

/** Необработанные исключения на странице: ровно то, чего быть не должно. */
function collectFailures(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const found = { pageErrors: [] as string[], consoleErrors: [] as string[] };
  page.on("pageerror", (error) => found.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("OnBoard")) {
      found.consoleErrors.push(message.text());
    }
  });
  return found;
}

test("при недоступном API сайт работает, ошибок нет", async ({ page }) => {
  const failures = collectFailures(page);
  await page.route("**/v1/public/config*", (route) => route.abort());

  await page.goto("/reports");
  await page.waitForLoadState("networkidle");

  // Виджета нет, но сайт жив: модалка стенда открывается как обычно.
  await expect(page.locator(HOST)).toHaveCount(0);
  await page.click('[data-testid="filters-button"]');
  await expect(page.locator("#modal")).toBeVisible();
  expect(failures.pageErrors).toEqual([]);
  expect(failures.consoleErrors).toEqual([]);
});

test("при недоступном ядре сайт работает, ошибок нет", async ({ page }) => {
  const failures = collectFailures(page);
  await page.route("**/core.*.js", (route) => route.abort());

  await page.goto("/reports");
  await page.waitForLoadState("networkidle");

  await page.click('[data-testid="filters-button"]');
  await expect(page.locator("#modal")).toBeVisible();
  expect(failures.pageErrors).toEqual([]);
});

test("на странице появляется ровно один наш глобал", async ({ page }) => {
  // Снимок без виджета: загрузчик заблокирован, страница та же самая.
  await page.route("**/widget/loader.js", (route) => route.abort());
  await page.goto("/reports");
  await page.waitForLoadState("networkidle");
  const before = await page.evaluate(() => Object.keys(window));

  await page.unroute("**/widget/loader.js");
  await page.goto("/reports");
  await expect(page.locator(TIP)).toBeVisible();
  const after = await page.evaluate(() => Object.keys(window));

  // Встроенные объекты не патчим, свои имена в window не складываем (инвариант №3).
  expect(after.filter((key) => !before.includes(key))).toEqual(["OnBoard"]);
});

test("разметка в тексте шага остаётся текстом", async ({ page }) => {
  const failures = collectFailures(page);

  // Текст демо-шага содержит <img src=x onerror=…> — он приехал из базы через
  // API, и ни в какой момент не должен был стать разметкой (инвариант №6).
  await page.goto("/delayed");
  await expect(page.locator(TIP)).toBeVisible();

  const executed = await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__xss !== undefined,
  );
  expect(executed).toBe(false);
  await expect(page.locator('[data-part="body"]')).toContainText("<img src=x");
  expect(failures.pageErrors).toEqual([]);
});

test("stop убирает виджет полностью, страница остаётся рабочей", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.locator(TIP)).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { OnBoard: { stop: () => void } }).OnBoard.stop();
  });

  await expect(page.locator(HOST)).toHaveCount(0);
  // Ни наших стилей, ни наших узлов.
  expect(await page.locator("head style").count()).toBe(0);
  await page.click('[data-testid="filters-button"]');
  await expect(page.locator("#modal")).toBeVisible();
});
