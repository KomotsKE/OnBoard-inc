import { expect, test, type Page } from "@playwright/test";

/**
 * Подсветка на настоящей странице (T2.3).
 *
 * Shadow root открыт именно для таких проверок (ADR-0002): заглянуть внутрь
 * и сверить геометрию выреза с положением цели можно только так.
 *
 * Данные — из `make seed`: тур на `/reports` начинается с кнопки «Фильтры»
 * в sticky-хедере, а тур на `/delayed` — с кнопки, которую стенд вставляет
 * через две секунды.
 */

const HOST = '[data-onboard="overlay"]';
const FILTERS = '[data-testid="filters-button"]';
const EXPORT = '[data-testid="export-button"]';

type Box = { x: number; y: number; width: number; height: number };

async function overlayStarted(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector(HOST, { state: "attached" });
}

/** Вырез читается из shadow root — ровно то, что рисует маска. */
async function hole(page: Page): Promise<Box> {
  return page.evaluate((host) => {
    const node = document.querySelector(host)?.shadowRoot?.querySelector('[data-part="hole"]');
    if (!node) {
      throw new Error("в оверлее нет выреза");
    }
    return {
      x: Number(node.getAttribute("x")),
      y: Number(node.getAttribute("y")),
      width: Number(node.getAttribute("width")),
      height: Number(node.getAttribute("height")),
    };
  }, HOST);
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`элемент ${selector} без геометрии`);
  }
  return box;
}

/** Зазор вокруг цели — 4 px, та же константа, что в overlay.ts. */
function expectHoleAround(hole: Box, target: Box): void {
  expect(hole.x).toBeCloseTo(target.x - 4, 0);
  expect(hole.y).toBeCloseTo(target.y - 4, 0);
  expect(hole.width).toBeCloseTo(target.width + 8, 0);
  expect(hole.height).toBeCloseTo(target.height + 8, 0);
}

test("вырез встаёт вокруг цели первого шага", async ({ page }) => {
  await overlayStarted(page, "/reports");

  expectHoleAround(await hole(page), await boxOf(page, FILTERS));
});

test("подсвеченная кнопка остаётся кликабельной", async ({ page }) => {
  await overlayStarted(page, "/reports");

  // Playwright сам проверяет, что клик доходит до элемента: перехвати его
  // оверлей — клик упал бы с «element intercepts pointer events».
  await page.click(FILTERS);

  // Обработчик самого стенда отработал: отверстие события не перехватывает.
  await expect(page.locator("#modal")).toBeVisible();
});

test("подсветка дожидается элемента, который появляется через 2 с", async ({ page }) => {
  await page.goto("/delayed");
  await expect(page.locator(EXPORT)).toHaveCount(0);

  await page.waitForSelector(EXPORT);
  await page.waitForSelector(HOST, { state: "attached" });

  await expect.poll(async () => (await hole(page)).width).toBeGreaterThan(0);
  expectHoleAround(await hole(page), await boxOf(page, EXPORT));
});

test("окно следует за целью при прокрутке", async ({ page }) => {
  await overlayStarted(page, "/delayed");
  await page.waitForSelector(EXPORT);
  await expect.poll(async () => (await hole(page)).width).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollBy(0, 200));
  // Пересчёт отложен до кадра, поэтому ждём устойчивого значения.
  await expect
    .poll(async () => (await hole(page)).y)
    .toBe((await boxOf(page, EXPORT)).y - 4);
});

test("DOM стенда не меняется", async ({ page }) => {
  await overlayStarted(page, "/reports");

  const attributes = await page.evaluate((selector) => {
    const target = document.querySelector(selector);
    return target ? [...target.attributes].map((attribute) => attribute.name).sort() : [];
  }, FILTERS);

  // Ни style, ни class, ни z-index: элемент клиента не трогаем (ADR-0003).
  expect(attributes).toEqual(["data-testid", "id", "type"]);
  // В документ клиента не добавлено ни одного нашего правила CSS (ADR-0002).
  expect(await page.locator("head style").count()).toBe(0);
  expect(await page.locator(`body > ${HOST}`).count()).toBe(1);
});

test("stop убирает оверлей и оставляет страницу как была", async ({ page }) => {
  await overlayStarted(page, "/reports");

  await page.evaluate(() => {
    (window as unknown as { OnBoard: { stop: () => void } }).OnBoard.stop();
  });

  await expect(page.locator(HOST)).toHaveCount(0);
  await page.click(FILTERS);
  await expect(page.locator("#modal")).toBeVisible();
});
