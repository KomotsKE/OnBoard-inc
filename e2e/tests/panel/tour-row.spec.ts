import { type Locator, type Page } from "@playwright/test";

import { asOwner, standProject } from "../../demo-api";
import { expect, test } from "./owner-session";
import { MENU_TESTID, openRowMenu } from "./tour-menu";

/**
 * Строка списка туров (T8.9b).
 *
 * В строке два действия — «Открыть» и «Ещё», остальное в меню. Перенос не
 * прячется: `flex-wrap` у `.table__actions` снят, поэтому переполнение здесь
 * видно как разные координаты `y` и как `scrollWidth > clientWidth`.
 *
 * Утверждения сгруппированы по предмету, по одному заходу в приложение на
 * сценарий: каждый заход — перезагрузка и обновление токена, а лимит
 * обновлений идёт с одного адреса на весь прогон (Замечания docs/tasklist.md).
 */

const DESKTOP = { width: 1280, height: 800 };
// Расчёт: кнопка 45 + паддинги ячейки 24 + рамка 1 = 70; запас на рендер шрифта.
const MAX_ROW_HEIGHT = 76;

test.use({ viewport: DESKTOP });

async function openList(page: Page): Promise<void> {
  const { id } = await standProject(await asOwner());
  await page.goto(`/projects/${id}/tours`);
  await expect(page.locator('[data-testid="tour-row"]').nth(1)).toBeVisible();
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) {
    throw new Error("у элемента нет рамки: он не показан");
  }
  return result;
}

test("раскладка строки: два действия на одной линии, без переполнения и прокрутки", async ({
  owner,
}) => {
  await openList(owner);
  // Строка с условием «адрес начинается с…» и без подсказки про шаги.
  const row = owner.locator('[data-testid="tour-row"]').filter({ hasText: "Знакомство" });
  const actions = row.locator(".table__actions");

  await expect(actions.locator("a:visible, button:visible")).toHaveCount(2);
  await expect(actions.getByRole("link", { name: "Открыть", exact: true })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Ещё" })).toBeVisible();

  const ys = await actions.locator("a, button").evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().y)),
  );
  expect(new Set(ys).size, `y действий: ${ys}`).toBe(1);
  expect((await box(row)).height).toBeLessThanOrEqual(MAX_ROW_HEIGHT);

  // «Открыть» ведёт туда же, куда имя тура.
  const open = await actions.getByRole("link", { name: "Открыть", exact: true }).getAttribute("href");
  expect(open).toBe(await row.locator(".table__title").getAttribute("href"));

  const [rowScroll, tableScroll] = await Promise.all([
    actions.evaluate((n) => [n.scrollWidth, n.clientWidth]),
    owner.locator(".table").first().evaluate((n) => [n.scrollWidth, n.clientWidth]),
  ]);
  expect(rowScroll[0], "scrollWidth ряда действий").toBeLessThanOrEqual(rowScroll[1]);
  expect(tableScroll[0], "scrollWidth таблицы").toBeLessThanOrEqual(tableScroll[1]);
});

test("меню: состав, клавиатура, клик мимо и выбор пункта", async ({ owner }) => {
  await openList(owner);
  const row = owner.locator('[data-testid="tour-row"]').first();
  const more = row.getByRole("button", { name: "Ещё" });
  const menu = owner.getByTestId(MENU_TESTID);

  // Состав.
  await openRowMenu(owner, row);
  await expect(menu.getByRole("link", { name: "Аналитика", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: /^(Опубликовать|Снять с публикации)$/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Удалить", exact: true })).toBeVisible();
  await owner.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Клавиатура: Enter открывает, Escape закрывает и возвращает фокус.
  await more.focus();
  await owner.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await owner.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  // Клик мимо.
  await openRowMenu(owner, row);
  await owner.getByRole("heading", { name: "Туры" }).click();
  await expect(menu).toHaveCount(0);

  // Выбор пункта закрывает меню и не накрывает подтверждение удаления.
  await openRowMenu(owner, row);
  await menu.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(menu).toHaveCount(0);
  const confirm = row.getByTestId("tour-confirm");
  await expect(confirm).toBeVisible();
  // Фокус вернулся на «Ещё», а не улетел в начало документа: подтверждение
  // удаления запросили с клавиатуры, и дальше человек идёт по строке.
  await expect(more).toBeFocused();

  // Не удаляем: демо-данные общие для всех сценариев.
  await confirm.getByRole("button", { name: "Отмена" }).click();
  await expect(confirm).toHaveCount(0);
});

test("меню второй строки встаёт у своей кнопки, а не у первой", async ({ owner }) => {
  await openList(owner);
  const second = owner.locator('[data-testid="tour-row"]').nth(1);
  const invoker = second.getByRole("button", { name: "Ещё" });
  const menu = await openRowMenu(owner, second);

  const anchor = await box(invoker);
  const list = await box(menu);
  const first = await box(
    owner.locator('[data-testid="tour-row"]').first().getByRole("button", { name: "Ещё" }),
  );

  // Меню прижато к кнопке по вертикали (снизу или сверху) ...
  const gapBelow = Math.abs(list.y - (anchor.y + anchor.height));
  const gapAbove = Math.abs(list.y + list.height - anchor.y);
  expect(Math.min(gapBelow, gapAbove), `меню y=${list.y}, кнопка y=${anchor.y}`).toBeLessThanOrEqual(16);
  // ... и перекрывается с ней по горизонтали.
  expect(list.x).toBeLessThanOrEqual(anchor.x + anchor.width);
  expect(list.x + list.width).toBeGreaterThanOrEqual(anchor.x);
  // Строки стоят на разной высоте, значит привязка к первой кнопке дала бы другое y.
  expect(anchor.y).toBeGreaterThan(first.y);
});
