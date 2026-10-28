import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Меню «Ещё» строки списка туров (T8.9b).
 *
 * Меню живёт в портале к `<body>`, а не внутри строки, поэтому пункты ищутся
 * от страницы. Открытое меню в каждый момент одно.
 */
export const MENU_TESTID = "tour-menu";

export async function openRowMenu(page: Page, row: Locator): Promise<Locator> {
  await row.getByRole("button", { name: "Ещё" }).click();
  const menu = page.getByTestId(MENU_TESTID);
  await expect(menu).toBeVisible();
  return menu;
}

/** Нажать пункт-кнопку меню строки; меню после выбора закрывается. */
export async function chooseInMenu(
  page: Page,
  row: Locator,
  role: "button" | "link",
  name: string,
): Promise<void> {
  const menu = await openRowMenu(page, row);
  await menu.getByRole(role, { name, exact: true }).click();
}
