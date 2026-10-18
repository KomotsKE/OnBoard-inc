import { expect, test, type Page } from "@playwright/test";

/**
 * SPA-навигация (T2.7).
 *
 * Стенд ходит по маршрутам через History API без перезагрузки — ровно как
 * настоящее одностраничное приложение. Для виджета это значит, что тур может
 * появиться и исчезнуть без единой загрузки страницы.
 */

const HOST = '[data-onboard="host"]';
const TIP = '[data-part="tip"]';

/** Метка на window: переживёт SPA-переход и не переживёт перезагрузку. */
async function mark(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__без_перезагрузки = true;
  });
}

async function markSurvived(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>).__без_перезагрузки === true,
  );
}

test("переход на страницу с туром запускает его без перезагрузки", async ({ page }) => {
  await page.goto("/settings");
  // На этой странице тура нет, ядро не грузится.
  await expect(page.locator(HOST)).toHaveCount(0);
  await mark(page);

  await page.click('[data-testid="nav-reports"]');

  await expect(page.locator(TIP)).toBeVisible();
  expect(await markSurvived(page)).toBe(true);
  expect(new URL(page.url()).pathname).toBe("/reports");
});

test("уход на страницу без тура закрывает тур", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.locator(TIP)).toBeVisible();
  await mark(page);

  await page.click('a[href="/settings"]');

  // Тур привязан к адресу: на посторонней странице ему делать нечего.
  await expect(page.locator(HOST)).toHaveCount(0);
  expect(await markSurvived(page)).toBe(true);
});

test("возврат кнопкой «назад» возвращает тур", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.locator(TIP)).toBeVisible();
  await page.click('a[href="/settings"]');
  await expect(page.locator(HOST)).toHaveCount(0);
  await mark(page);

  await page.goBack();

  await expect(page.locator(TIP)).toBeVisible();
  expect(await markSurvived(page)).toBe(true);
});

test("обёртка сайта над pushState продолжает работать", async ({ page }) => {
  // Счётчик ставится до нашего загрузчика — как у сайта, который сам следит
  // за навигацией. Наша обёртка ложится поверх и обязана звать оригинал.
  await page.addInitScript(() => {
    const original = history.pushState;
    (window as unknown as Record<string, unknown>).__вызовов_сайта = 0;
    history.pushState = function (...args: Parameters<History["pushState"]>) {
      (window as unknown as Record<string, number>).__вызовов_сайта += 1;
      return original.apply(this, args);
    };
  });

  await page.goto("/reports");
  await expect(page.locator(TIP)).toBeVisible();
  await page.click('[data-testid="nav-dashboard"]');

  const calls = await page.evaluate(
    () => (window as unknown as Record<string, number>).__вызовов_сайта,
  );
  // Сайт о переходе узнал: его счётчик вырос, значит наша обёртка позвала
  // оригинал, а не подменила его собой.
  expect(calls).toBeGreaterThanOrEqual(1);
  expect(new URL(page.url()).pathname).toBe("/dashboard");
  // И мы о переходе узнали тоже: на /dashboard тур не распространяется.
  // Без этой половины сценарий проходил бы и без нашей обёртки вовсе.
  await expect(page.locator(HOST)).toHaveCount(0);
});
