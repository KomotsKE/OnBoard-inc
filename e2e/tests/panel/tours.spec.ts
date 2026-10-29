import { type Page } from "@playwright/test";

import { expect, test } from "./owner-session";
import { chooseInMenu, openRowMenu } from "./tour-menu";
import { openNewTourForm, readSummary } from "./tours-header";

/**
 * Список туров (T3.4).
 *
 * Главное утверждение: опубликованный в панели тур немедленно виден виджету.
 * Проверяется запросом конфига со страницы стенда — тем же, который делает
 * загрузчик.
 *
 * Публикация проверяется на черновике из `make seed`, который не трогают
 * сценарии виджета: иначе результат зависел бы от порядка запуска.
 */

import { API_URL as API, STAND_URL as STAND } from "../../urls";
const DRAFT = "Черновик для проверки";

async function openTours(page: Page): Promise<void> {
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: "Отчётница" });
  await card.getByRole("link", { name: "Туры", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Туры" })).toBeVisible();
}

/** Что отдаёт конфиг виджета для адреса: имя тура или «нет тура». */
async function tourForPage(page: Page, path: string): Promise<string> {
  const stand = await page.context().newPage();
  await stand.goto(`${STAND}/settings`);
  const name = await stand.evaluate(
    async ([api, url]) => {
      const response = await fetch(
        `${api}/v1/public/config?key=pk_00000000000000000000000000000001&url=${encodeURIComponent(url)}`,
        // Конфиг отдаётся с max-age=60: виджету это экономит запросы, а проверке
        // подсунуло бы ответ, снятый до публикации.
        { cache: "no-store" },
      );
      const body = (await response.json()) as { tour: { name: string } | null };
      return body.tour?.name ?? "нет тура";
    },
    [API, path] as const,
  );
  await stand.close();
  return name;
}

test("публикация делает тур видимым виджету, снятие — скрывает", async ({ owner: page }) => {
  await page.goto("/projects");
  await openTours(page);
  const row = page.locator('[data-testid="tour-row"]').filter({ hasText: DRAFT });

  await expect(row).toContainText(/черновик/i);
  expect(await tourForPage(page, "/panel-check")).toBe("нет тура");
  const before = await readSummary(page);

  await chooseInMenu(page, row, "button", "Опубликовать");
  await expect(row).toContainText(/опубликован/i);
  // Публикация меняет «M опубликованы» на единицу, число туров и запусков — нет.
  await expect.poll(async () => (await readSummary(page)).published).toBe(before.published + 1);
  expect(await readSummary(page)).toMatchObject({ tours: before.tours, runs: before.runs });

  expect(await tourForPage(page, "/panel-check")).toBe(DRAFT);

  // Возвращаем как было: демо-данные общие для всех сценариев.
  await chooseInMenu(page, row, "button", "Снять с публикации");
  await expect(row).toContainText(/черновик/i);
  expect(await tourForPage(page, "/panel-check")).toBe("нет тура");
  await expect.poll(async () => (await readSummary(page)).published).toBe(before.published);
});

test("список показывает запуски и долю дошедших до конца за 7 дней", async ({
  owner: page,
}) => {
  await page.goto("/projects");
  await openTours(page);

  // Абсолютные числа не проверяем: сценарии виджета проходят демо-тур
  // по-настоящему и честно добавляют прогоны — это и есть признак того,
  // что события доезжают. Проверяем, что цифры живые и стоят столбцами:
  // подписи «запусков за 7 дней» ушли в заголовки таблицы.
  const live = page.locator('[data-testid="tour-row"]').filter({ hasText: "Знакомство" });
  await expect(live.getByTestId("tour-metrics")).toHaveText(/^\d+$/);
  await expect(live.locator("td.table__number").last()).toHaveText(/^\d+ %$/);

  // У тура, который никто не проходил, не «0 %», а отсутствие данных.
  const draft = page.locator('[data-testid="tour-row"]').filter({ hasText: DRAFT });
  await expect(draft.getByTestId("tour-metrics")).toHaveText("—");
  await expect(draft.locator("td.table__number").last()).toHaveText("—");

  // Полоса доли: у тура с запусками есть, у тура с прочерком нет совсем —
  // пустая дорожка читалась бы как ноль.
  const percent = Number(
    ((await live.locator("td.table__number").last().textContent()) ?? "").replace(/\D/g, ""),
  );
  await expect(live.getByTestId("completion-bar")).toBeVisible();
  const width = await live.getByTestId("completion-fill").evaluate((el) => (el as HTMLElement).style.width);
  expect(Math.abs(parseFloat(width) - percent)).toBeLessThanOrEqual(1);
  await expect(draft.getByTestId("completion-bar")).toHaveCount(0);

  // На непустом списке форма создания скрыта до нажатия «Новый тур».
  await expect(page.getByLabel("Название нового тура")).toBeHidden();
  const toggle = page.getByRole("button", { name: "Новый тур", exact: true });
  await openNewTourForm(page);
  const controlled = await toggle.getAttribute("aria-controls");
  expect(controlled).toBeTruthy();
  await expect(
    page.locator(`[id="${controlled}"]`).getByLabel("Название нового тура"),
  ).toBeVisible();
  // Явное закрытие возвращает фокус на кнопку.
  await toggle.click();
  await expect(page.getByLabel("Название нового тура")).toBeHidden();
  await expect(toggle).toBeFocused();

  await expect(
    page.locator('[data-testid="tour-row"]').filter({ hasText: "Знакомство" }),
  ).toContainText("адрес начинается с «/reports»");
});

test("тур без шагов опубликовать нельзя, и видно почему", async ({ owner: page }) => {
  const name = `Пустой ${Date.now().toString().slice(-6)}`;
  await page.goto("/projects");
  await openTours(page);

  const before = await readSummary(page);
  await openNewTourForm(page);
  await page.getByLabel("Название нового тура").fill(name);
  await page.getByRole("button", { name: "Создать" }).click();

  const row = page.locator('[data-testid="tour-row"]').filter({ hasText: name });
  await expect.poll(async () => (await readSummary(page)).tours).toBe(before.tours + 1);
  // Форма после создания не схлопывается: можно сразу вводить следующий.
  await expect(page.getByLabel("Название нового тура")).toBeVisible();
  await expect(page.getByLabel("Название нового тура")).toHaveValue("");
  // Столбец «Шагов» — число: подпись стоит в заголовке таблицы.
  await expect(row.locator("td.table__number").first()).toHaveText("0");
  const menu = await openRowMenu(page, row);
  await expect(menu.getByRole("button", { name: "Опубликовать" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(row.getByTestId("tour-no-steps")).toBeVisible();

  // Прибираем за собой.
  await chooseInMenu(page, row, "button", "Удалить");
  await row.getByTestId("tour-confirm").getByRole("button", { name: "Удалить" }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(async () => (await readSummary(page)).tours).toBe(before.tours);
});
