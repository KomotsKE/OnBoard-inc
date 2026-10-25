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

  // Проект «Второй сайт» из make seed не трогает ни один другой сценарий:
  // в «Отчётнице» соседние сценарии создают и удаляют свои туры, и число
  // на карточке успевало разойтись со списком прямо посреди проверки.
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: "Второй сайт" });
  await expect(card).toContainText("0 туров");

  await card.getByRole("link", { name: "Туры", exact: true }).click();

  await expect(page.getByTestId("tours-empty")).toBeVisible();
  await expect(page.getByTestId("tour-row")).toHaveCount(0);
});

test("карточка показывает состояние виджета, ключ и подсказку", async ({ owner: page }) => {
  const suffix = Date.now().toString().slice(-6);
  const fresh = `Без виджета ${suffix}`;

  await page.goto("/projects");
  await createProject(page, fresh);

  const card = page.locator('[data-testid="project-card"]').filter({ hasText: fresh });
  // Состояние названо словом, а не одним цветом: иначе список читается наугад.
  await expect(card.getByTestId("widget-state")).toHaveText(/виджет .*не найден/);
  await expect(card.getByTestId("project-key")).toHaveText(/^pk_[0-9a-f]{32}$/);
  await expect(card).toContainText("сниппет");

  // У демо-проекта стенда виджет запрашивал конфиг — состояние другое.
  const stand = page.locator('[data-testid="project-card"]').filter({ hasText: "Отчётница" });
  await expect(stand.getByTestId("widget-state")).toHaveText(/подключён/);

  await removeProject(page, fresh);
});

test("чужой проект даёт «не найдено», а не общую ошибку", async ({ owner: page }) => {
  // 404 от API не различает «нет такого» и «не ваше» (ADR-0006) — экран тоже.
  await page.goto("/projects/0b5b3c4e-0000-4000-8000-000000000000/tours");

  await expect(page.getByRole("heading", { name: "Не найдено" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(0);

  await page.getByRole("link", { name: "К проектам" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("ряд действий карточки выровнен по центру блока с названием", async ({ owner: page }) => {
  const suffix = Date.now().toString().slice(-6);
  const fresh = `Геометрия ${suffix}`;

  // Ширина фиксирована: на узком экране flex-wrap переносит ряд действий и
  // геометрия другая.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/projects");
  await createProject(page, fresh);

  // У карточки без виджета под рядом стоит подсказка, поэтому с центром всей
  // карточки сравнивать нельзя — только с блоком названия.
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: fresh });
  await expect(card.locator(".projects__hint")).toBeVisible();

  const about = await card.locator(".projects__about").boundingBox();
  const links = await card.locator(".projects__links").boundingBox();
  const center = (box: { y: number; height: number } | null) => box!.y + box!.height / 2;
  expect(Math.abs(center(links) - center(about))).toBeLessThanOrEqual(2);

  await removeProject(page, fresh);
});
