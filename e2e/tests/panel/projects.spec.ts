import { type Page } from "@playwright/test";

import { expect, test } from "./owner-session";

/**
 * Проекты (T3.2).
 *
 * Сценарий один и длинный намеренно: каждый вход расходует настоящий лимит
 * (см. demo-owner.ts), а проверяемые утверждения связаны одной историей —
 * создать, переключиться, удалить.
 */

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByLabel("Название нового проекта").fill(name);
  await page.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function removeProject(page: Page, name: string): Promise<void> {
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: name });
  await card.getByRole("button", { name: "Удалить" }).click();

  const confirm = card.getByRole("button", { name: "Удалить навсегда" });
  // Пока имя не введено, кнопка недоступна: каскад уносит туры и аналитику.
  await expect(confirm).toBeDisabled();
  await card.getByLabel(`Подтверждение удаления проекта ${name}`).fill(name);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(card).toHaveCount(0);
}

test("создание двух проектов, переключение контекста и удаление", async ({ owner: page }) => {
  const suffix = Date.now().toString().slice(-6);
  const first = `Первый ${suffix}`;
  const second = `Второй ${suffix}`;

  await page.goto("/projects");
  await createProject(page, first);
  await createProject(page, second);

  // Переключатель в шапке ведёт на тот же раздел другого проекта: выбор
  // проекта — это адрес, а не состояние в памяти.
  await page.getByRole("link", { name: first }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/tours$/);
  const firstUrl = page.url();

  const switcher = page.getByTestId("project-switcher");
  await expect(switcher).toHaveValue(/[0-9a-f-]+/);
  await switcher.selectOption({ label: second });

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/tours$/);
  expect(page.url()).not.toBe(firstUrl);
  await expect(switcher).toHaveValue(new URL(page.url()).pathname.split("/")[2]!);

  // Прибираем за собой: у владельца не больше десяти проектов, и прогоны
  // не должны съедать этот запас.
  await page.goto("/projects");
  await removeProject(page, first);
  await removeProject(page, second);
});

test("карточка проекта показывает число туров", async ({ owner: page }) => {
  await page.goto("/projects");

  // Демо-проект стенда: четыре тура (см. make seed). Статус подключения виджета
  // проверяется там, где он меняется, — в сценарии экрана установки.
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: "Отчётница" });

  await expect(card).toContainText("4 тура");
});
