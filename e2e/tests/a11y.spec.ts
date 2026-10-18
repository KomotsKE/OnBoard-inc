import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Доступность тура (T2.6).
 *
 * Проверяется то, что можно проверить машиной: проход с клавиатуры без мыши
 * и отсутствие критичных нарушений по axe-core. Чтение экранным диктором —
 * ручной пункт приёмки (§3 docs/workflow.md): движка озвучки в окружении нет,
 * и изображать эту проверку нельзя.
 */

const HOST = '[data-onboard="host"]';
const TIP = '[data-part="tip"]';

async function started(page: Page, path = "/reports"): Promise<void> {
  await page.goto(path);
  await expect(page.locator(TIP)).toBeVisible();
}

/** Что сейчас в фокусе внутри подсказки — фокус живёт в shadow root. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-onboard="host"]')?.shadowRoot;
    const active = root?.activeElement as HTMLElement | null;
    return active?.dataset.part ?? "—";
  });
}

test("тур проходится с клавиатуры без мыши", async ({ page }) => {
  await started(page);
  // Фокус приходит на подсказку сам — мышью её никто не трогал.
  expect(await focused(page)).toBe("tip");

  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-part="title"]')).toHaveText("Экспорт");

  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[data-part="title"]')).toHaveText("Фильтры");

  // И кнопками: Tab до «Далее», затем Enter.
  await page.keyboard.press("Tab");
  expect(await focused(page)).toBe("skip");
  await page.keyboard.press("Tab");
  expect(await focused(page)).toBe("next");
  await page.keyboard.press("Enter");

  await expect(page.locator('[data-part="title"]')).toHaveText("Экспорт");
});

test("Tab не выпускает фокус из подсказки", async ({ page }) => {
  await started(page);

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");

  // С последней кнопки — обратно на первую, а не в страницу под затемнением.
  expect(await focused(page)).toBe("skip");
});

test("Esc пропускает тур и возвращает фокус странице", async ({ page }) => {
  await started(page);

  await page.keyboard.press("Escape");

  await expect(page.locator(HOST)).toHaveCount(0);
  const active = await page.evaluate(() => document.activeElement?.tagName ?? "—");
  expect(active).not.toBe("—");
});

test("axe-core не находит критичных нарушений в подсказке", async ({ page }) => {
  await started(page);

  const results = await new AxeBuilder({ page }).include(HOST).analyze();

  const serious = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    serious.map((violation) => `${violation.id}: ${violation.help}`),
    "нарушения доступности в подсказке",
  ).toEqual([]);
});
