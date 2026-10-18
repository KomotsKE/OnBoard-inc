import { expect, test, type Page } from "@playwright/test";

/**
 * Движок тура на настоящей странице (T2.5).
 *
 * Демо-тур из `make seed` ведёт по четырём целям в разных углах стенда,
 * поэтому проход по нему заодно показывает подсказку со всех сторон — это
 * долг T2.4, который без кнопки «Далее» было нечем закрыть.
 */

const HOST = '[data-onboard="host"]';
const TIP = '[data-part="tip"]';
const NEXT = '[data-part="next"]';
const BACK = '[data-part="back"]';
const SKIP = '[data-part="skip"]';

async function started(page: Page, path = "/reports"): Promise<void> {
  await page.goto(path);
  await expect(page.locator(TIP)).toBeVisible();
}

async function title(page: Page): Promise<string> {
  return (await page.locator('[data-part="title"]').textContent()) ?? "";
}

/**
 * Жмёт «Далее» и дожидается именно следующего шага.
 *
 * Ждать «видимости подсказки» мало: она не исчезает на время поиска цели,
 * и тест успевал нажать второй раз раньше, чем показывался шаг.
 */
async function goNext(page: Page, expected: string): Promise<void> {
  await page.locator(NEXT).click();
  await expect(page.locator('[data-part="title"]')).toHaveText(expected);
}

/** Сколько точек прогресса закрашено — по ним видно номер шага. */
async function current(page: Page): Promise<number> {
  return page.locator('[data-part="dots"] [data-current]').count();
}

test("полный проход по четырём шагам", async ({ page }) => {
  await started(page);

  expect(await title(page)).toBe("Фильтры");
  expect(await current(page)).toBe(1);
  // Шаг 2 ждёт отложенную кнопку, шаги 3 и 4 — прокрутки к цели.
  await goNext(page, "Экспорт");
  await goNext(page, "Тёмная секция");
  await goNext(page, "Цель в прокрутке");
  await page.locator(NEXT).click();

  // На последнем шаге кнопка называется «Готово» и закрывает тур.
  await expect(page.locator(HOST)).toHaveCount(0);
});

test("подсказка не выходит за экран ни на одном шаге", async ({ page }) => {
  await started(page);
  const viewport = page.viewportSize()!;

  // Цели стоят в разных углах страницы, поэтому стороны подсказки за проход
  // меняются — это и есть проверка разворотов на живой вёрстке (долг T2.4).
  for (const step of ["Экспорт", "Тёмная секция", "Цель в прокрутке", null]) {
    const tip = await page.locator(TIP).boundingBox();
    expect(tip).not.toBeNull();
    expect(tip!.x).toBeGreaterThanOrEqual(0);
    expect(tip!.y).toBeGreaterThanOrEqual(0);
    expect(tip!.x + tip!.width).toBeLessThanOrEqual(viewport.width);
    expect(tip!.y + tip!.height).toBeLessThanOrEqual(viewport.height);
    if (step === null) {
      break;
    }
    await goNext(page, step);
  }
});

test("цель ниже сгиба показывается посетителю", async ({ page }) => {
  await started(page);
  await goNext(page, "Экспорт");

  await goNext(page, "Тёмная секция");

  // Третий шаг — в тёмной секции внизу страницы: страница прокрутилась к ней.
  const target = await page.locator('[data-testid="dark-target"]').boundingBox();
  expect(target!.y).toBeGreaterThanOrEqual(0);
  expect(target!.y + target!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test("«Назад» возвращает на предыдущий шаг", async ({ page }) => {
  await started(page);
  // На первом шаге возвращаться некуда.
  await expect(page.locator(BACK)).toBeHidden();

  await goNext(page, "Экспорт");
  await expect(page.locator(BACK)).toBeVisible();
  await page.locator(BACK).click();

  await expect(page.locator('[data-part="title"]')).toHaveText("Фильтры");
});

test("пропуск на втором шаге закрывает тур", async ({ page }) => {
  await started(page);
  await goNext(page, "Экспорт");

  await page.locator(SKIP).click();

  await expect(page.locator(HOST)).toHaveCount(0);
  // Страница клиента осталась рабочей.
  await page.click('[data-testid="filters-button"]');
  await expect(page.locator("#modal")).toBeVisible();
});

test("тур с show_once не возвращается после перезагрузки", async ({ page }) => {
  await started(page, "/once");
  await page.locator(NEXT).click();
  await expect(page.locator(HOST)).toHaveCount(0);

  await page.reload();

  // Ждать нечего: конфиг запрашивается и тур приходит, но ядро его не покажет.
  await page.waitForLoadState("networkidle");
  await expect(page.locator(HOST)).toHaveCount(0);
});

test("тур продолжается после перехода на другую страницу", async ({ page }) => {
  await started(page);
  await goNext(page, "Экспорт");

  // Другой адрес с полной перезагрузкой: условие показа тура (префикс
  // /reports) ему подходит, прогресс остался в localStorage.
  await page.goto("/reports?page=2");

  await expect(page.locator('[data-part="title"]')).toHaveText("Экспорт");
  // Именно продолжение, а не показ сначала.
  await expect(page.locator('[data-part="dots"] span').first()).not.toHaveAttribute(
    "data-current",
    "",
  );
});

test("при отключённом localStorage тур проходится", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("данные сайтов отключены");
      },
    });
  });

  await started(page);
  await goNext(page, "Экспорт");

  // Деградация, а не поломка: тур работает, просто покажется ещё раз.
  await expect(page.locator(TIP)).toBeVisible();
});
