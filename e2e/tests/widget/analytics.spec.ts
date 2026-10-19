import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * Доставка событий (T4.2).
 *
 * Проверяется то, ради чего буфер вообще существует: события переживают
 * закрытие вкладки и недоступность API. Смотрим на сетевые запросы и на то,
 * что уходит в теле, — состояние буфера изнутри не наблюдаемо и не должно быть.
 */

const EVENTS = "**/v1/public/events";

type Batch = { key: string; events: { type: string; run_id?: string }[] };

function batchesOf(requests: Request[]): Batch[] {
  return requests.map((request) => JSON.parse(request.postData() ?? "{}") as Batch);
}

function collect(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/public/events")) {
      requests.push(request);
    }
  });
  return requests;
}

test("события тура уходят батчем, а не по одному", async ({ page }) => {
  const requests = collect(page);

  await page.goto("/reports");
  await expect(page.locator('[data-part="tip"]')).toBeVisible();
  await page.waitForTimeout(5500);

  const events = batchesOf(requests).flatMap((batch) => batch.events);
  expect(requests.length).toBe(1);
  expect(events.map((event) => event.type)).toEqual(["tour_started", "step_viewed"]);
  // Вся воронка считается по одному run_id прохода (§7.2 docs/vision.md).
  expect(new Set(events.map((event) => event.run_id)).size).toBe(1);
});

test("уход со страницы посреди тура доставляет накопленное", async ({ page }) => {
  const requests = collect(page);

  await page.goto("/reports");
  await expect(page.locator('[data-part="tip"]')).toBeVisible();

  // Вкладку скрыли раньше, чем сработал таймер буфера. Именно на этот момент
  // подписан виджет: дальше батч отдаёт sendBeacon, и доставляет его браузер.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect.poll(() => requests.length).toBeGreaterThan(0);
  const events = batchesOf(requests).flatMap((batch) => batch.events);
  expect(events.map((event) => event.type)).toContain("tour_started");
});

test("при недоступном API события уходят при следующей загрузке", async ({ page }) => {
  // Первая загрузка: приём событий лежит.
  await page.route(EVENTS, (route) => route.abort());
  await page.goto("/reports");
  await expect(page.locator('[data-part="tip"]')).toBeVisible();

  // Ждём не по часам, а по факту: батч лёг в localStorage, значит повторы
  // кончились и событие дождётся следующей загрузки.
  await expect
    .poll(
      () =>
        page.evaluate(() => Object.keys(localStorage).some((key) => key.includes("outbox"))),
      { timeout: 30_000 },
    )
    .toBe(true);

  // Вторая загрузка: приём работает, отложенное уходит первым.
  await page.unroute(EVENTS);
  const requests = collect(page);
  await page.goto("/reports");
  await expect(page.locator('[data-part="tip"]')).toBeVisible();
  // Два прогона: отложенный с прошлой загрузки и текущий. Второй уходит
  // по таймеру буфера, поэтому ждём по факту, а не по часам.
  await expect
    .poll(
      () =>
        batchesOf(requests)
          .flatMap((batch) => batch.events)
          .filter((event) => event.type === "tour_started").length,
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(2);

  // Отложенное отправлено и больше не висит.
  expect(
    await page.evaluate(() => Object.keys(localStorage).some((key) => key.includes("outbox"))),
  ).toBe(false);
});

test("на 429 отправка повторяется, события не теряются", async ({ page }) => {
  let rejected = 0;
  await page.route(EVENTS, async (route) => {
    rejected += 1;
    if (rejected === 1) {
      await route.fulfill({ status: 429, headers: { "Retry-After": "1" }, body: "" });
      return;
    }
    await route.continue();
  });
  const requests = collect(page);

  await page.goto("/reports");
  await expect(page.locator('[data-part="tip"]')).toBeVisible();
  await page.waitForTimeout(7000);

  const batches = batchesOf(requests);
  expect(batches.length).toBeGreaterThanOrEqual(2);
  // Повтор несёт те же события, а не пустой батч.
  expect(batches[1]?.events.map((event) => event.type)).toEqual(
    batches[0]?.events.map((event) => event.type),
  );
});
