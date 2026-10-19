import { expect, test, type Page } from "@playwright/test";

/**
 * Подсказка на стенде с враждебным CSS (T2.4).
 *
 * Проверяется то, ради чего подсказка живёт в Shadow DOM: сбросы и `!important`
 * со страницы клиента до неё не достают, а она ничего не добавляет в его
 * документ (ADR-0002). Развороты и сдвиги при нехватке места разобраны
 * по отдельности в юнит-тестах `place()` — там их видно все, а не те, что
 * удалось подстроить на стенде.
 */

const HOST = '[data-onboard="host"]';
const TIP = '[data-part="tip"]';
const FILTERS = '[data-testid="filters-button"]';

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`элемент ${selector} без геометрии`);
  }
  return box;
}

async function shown(page: Page, path = "/reports"): Promise<void> {
  await page.goto(path);
  await page.waitForSelector(HOST, { state: "attached" });
  await expect(page.locator(TIP)).toBeVisible();
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

test("подсказка показывает текст шага рядом с целью", async ({ page }) => {
  await shown(page);

  // Текст из демо-данных: подсказка берёт его из конфига, а не из разметки.
  await expect(page.locator('[data-part="title"]')).toHaveText("Фильтры");
  await expect(page.locator('[data-part="body"]')).toHaveText("Отчёт настраивается здесь.");

  const tip = await boxOf(page, TIP);
  const target = await boxOf(page, FILTERS);
  // Подсказка не закрывает то, о чём рассказывает.
  expect(overlaps(tip, target)).toBe(false);
  // И не уезжает от цели: расстояние по вертикали — зазор плюс носик.
  expect(tip.y - (target.y + target.height)).toBeLessThan(40);
});

test("подсказка остаётся в пределах экрана", async ({ page }) => {
  await shown(page);
  const viewport = page.viewportSize()!;

  const tip = await boxOf(page, TIP);

  expect(tip.x).toBeGreaterThanOrEqual(0);
  expect(tip.y).toBeGreaterThanOrEqual(0);
  expect(tip.x + tip.width).toBeLessThanOrEqual(viewport.width);
  expect(tip.y + tip.height).toBeLessThanOrEqual(viewport.height);
});

test("враждебный CSS страницы до подсказки не достаёт", async ({ page }) => {
  await shown(page);

  const styles = await page.evaluate(() => {
    const root = document.querySelector('[data-onboard="host"]')?.shadowRoot;
    const button = root?.querySelector('[data-part="next"]');
    const body = root?.querySelector('[data-part="body"]');
    if (!button || !body) {
      throw new Error("подсказка не собрана");
    }
    return {
      buttonFont: getComputedStyle(button).fontFamily,
      buttonBackground: getComputedStyle(button).backgroundColor,
      bodyFont: getComputedStyle(body).fontFamily,
    };
  });

  // На странице стоит `* { font-family: Georgia !important }` и `button { all: unset }`.
  expect(styles.bodyFont).not.toContain("Georgia");
  expect(styles.buttonFont).not.toContain("Georgia");
  expect(styles.buttonBackground).not.toBe("rgba(0, 0, 0, 0)");
});

test("в документ клиента не добавлено ни одного стиля", async ({ page }) => {
  await shown(page);

  expect(await page.locator("head style").count()).toBe(0);
  expect(await page.locator("body > style").count()).toBe(0);
  // Единственный наш след в документе — хост.
  expect(await page.locator(`body > ${HOST}`).count()).toBe(1);
});

test("«Пропустить» убирает виджет и оставляет страницу рабочей", async ({ page }) => {
  await shown(page);

  await page.locator('[data-part="skip"]').click();

  await expect(page.locator(HOST)).toHaveCount(0);
  await page.click(FILTERS);
  await expect(page.locator("#modal")).toBeVisible();
});

test.describe("узкий экран", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("подсказка становится панелью у нижнего края и не вылезает за экран", async ({ page }) => {
    await shown(page);

    const tip = await boxOf(page, TIP);
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(375);
    // Прижата к низу: привязка к цели на такой ширине закрывала бы пол-экрана.
    expect(tip.y + tip.height).toBeLessThanOrEqual(667);
    expect(667 - (tip.y + tip.height)).toBeLessThan(20);
    // Носик у панели не нужен.
    await expect(page.locator('[data-part="arrow"]')).toBeHidden();
  });
});
