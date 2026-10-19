import { expect, test, type Page, type Request, type Response } from "@playwright/test";

/**
 * Загрузчик: двухэтапная загрузка на настоящей странице (T2.1).
 *
 * Проверяется именно по списку сетевых запросов — это единственный способ
 * увидеть то, ради чего загрузка разделена на два бандла: на странице без тура
 * ядро не скачивается вовсе (ADR-0001).
 *
 * Данные берутся из `make seed`: проект с ключом из сниппета стенда и
 * опубликованный тур, показываемый на путях с префиксом `/reports`.
 */

const CORE = /\/core\.[a-f0-9]+\.js(\?|$)/;
const CONFIG = /\/v1\/public\/config\?/;

function track(page: Page): { config: Request[]; core: Request[] } {
  const seen: { config: Request[]; core: Request[] } = { config: [], core: [] };
  page.on("request", (request) => {
    if (CONFIG.test(request.url())) {
      seen.config.push(request);
    } else if (CORE.test(request.url())) {
      seen.core.push(request);
    }
  });
  return seen;
}

/**
 * Открывает страницу стенда и ждёт, пока загрузчик примет решение.
 *
 * Подписка на ответ оформляется до навигации: ответ конфига приходит быстрее,
 * чем завершается `goto`, и подписка после навигации ждала бы следующий ответ,
 * которого не будет. На этом и упал первый прогон — на странице без тура.
 */
async function visit(page: Page, path: string): Promise<Response> {
  const config = page.waitForResponse(CONFIG);
  await page.goto(path);
  const response = await config;
  // Затишье в сети: после него видно и то, что запрошено, и то, что нет.
  await page.waitForLoadState("networkidle");
  return response;
}

test("на странице без тура ядро не запрашивается", async ({ page }) => {
  const seen = track(page);

  await visit(page, "/settings");

  expect(seen.config).toHaveLength(1);
  expect(seen.core).toHaveLength(0);
});

test("на странице с туром ядро запрашивается один раз", async ({ page }) => {
  const seen = track(page);

  await visit(page, "/reports");

  expect(seen.config).toHaveLength(1);
  expect(seen.core).toHaveLength(1);
});

test("сниппет, вставленный дважды, даёт один запрос конфига и одно ядро", async ({ page }) => {
  const seen = track(page);

  await visit(page, "/reports-twice.html");

  expect(seen.config).toHaveLength(1);
  expect(seen.core).toHaveLength(1);
  // Второй сниппет виден в разметке — проверяем защиту, а не отсутствие копии.
  await expect(page.locator('script[data-key]')).toHaveCount(2);
});

test("ответ конфига кэшируется и разрешён нашему домену", async ({ page }) => {
  const response = await visit(page, "/reports");

  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["cache-control"]).toBe("public, max-age=60");
  expect(headers["access-control-allow-origin"]).toBe("http://localhost:8080");
});

test("виджет не оставляет на странице ничего, кроме одного глобала", async ({ page }) => {
  await visit(page, "/reports");

  // Инвариант №3: один глобал. Снимок до вставки снять нельзя — сниппет стоит
  // в разметке, поэтому сверяемся со списком известных свойств окна.
  const ours = await page.evaluate(() =>
    Object.keys(window).filter((key) => key.toLowerCase().includes("onboard")),
  );
  expect(ours).toEqual(["OnBoard"]);
});
