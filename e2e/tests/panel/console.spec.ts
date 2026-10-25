import { type APIRequestContext } from "@playwright/test";

import { asOwner, standProject } from "../../demo-api";
import { expect, test } from "./owner-session";

/**
 * Каркас консоли (T8.2).
 *
 * Проверяется то, ради чего каркас и делается: все разделы проекта
 * достижимы кликом с любого его экрана. До этого «Оформление» существовало
 * только по прямому адресу — ни одной ссылки на него в интерфейсе не было.
 */

const NAV = '[data-testid="project-nav"]';

async function projectId(api: APIRequestContext): Promise<string> {
  return (await standProject(api)).id;
}

test("разделы проекта достижимы кликом с любого экрана", async ({ owner }) => {
  const api = await asOwner();
  const id = await projectId(api);

  await owner.goto(`/projects/${id}/tours`);
  await expect(owner.locator(NAV)).toBeVisible();

  await owner.locator(NAV).getByRole("link", { name: "Оформление" }).click();
  await expect(owner).toHaveURL(new RegExp(`/projects/${id}/branding$`));
  await expect(owner.getByRole("heading", { name: "Оформление" })).toBeVisible();

  await owner.locator(NAV).getByRole("link", { name: "Установка" }).click();
  await expect(owner).toHaveURL(new RegExp(`/projects/${id}/install$`));

  await owner.locator(NAV).getByRole("link", { name: "Туры" }).click();
  await expect(owner).toHaveURL(new RegExp(`/projects/${id}/tours$`));
});

test("текущий раздел отмечен для чтения с экрана", async ({ owner }) => {
  const api = await asOwner();
  const id = await projectId(api);

  await owner.goto(`/projects/${id}/install`);

  // aria-current, а не только цвет: положение в навигации должно быть
  // понятно и без зрения.
  await expect(owner.locator(NAV).getByRole("link", { name: "Установка" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(owner.locator(NAV).getByRole("link", { name: "Туры" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("каркас виден и в конструкторе тура", async ({ owner }) => {
  const api = await asOwner();
  const id = await projectId(api);
  const tours = await (await api.get(`/v1/projects/${id}/tours`)).json();
  const tourId = (tours.items as { id: string }[])[0]?.id;

  await owner.goto(`/projects/${id}/tours/${tourId}`);

  await expect(owner.locator(NAV)).toBeVisible();
  await expect(owner.getByTestId("project-switcher")).toBeVisible();
});

test("на списке проектов разделов проекта нет", async ({ owner }) => {
  await owner.goto("/projects");

  // Разделы принадлежат проекту: показывать их, пока проект не выбран, значит
  // обещать переход в никуда.
  await expect(owner.locator(NAV)).toHaveCount(0);
  await expect(owner.getByTestId("owner-email")).toBeVisible();
});

test("в боковой колонке видно состояние виджета проекта", async ({ owner }) => {
  const api = await asOwner();
  const id = await projectId(api);

  await owner.setViewportSize({ width: 1280, height: 800 });
  await owner.goto(`/projects/${id}/tours`);

  // У демо-проекта стенда виджет запрашивал конфиг. Состояние названо словом,
  // а не только цветом точки.
  const state = owner.locator(".console__aside").getByTestId("aside-widget-state");
  await expect(state).toHaveText("Виджет подключён");
});

test("на списке проектов блока состояния виджета в колонке нет", async ({ owner }) => {
  await owner.setViewportSize({ width: 1280, height: 800 });
  await owner.goto("/projects");

  await expect(owner.getByTestId("owner-email")).toBeVisible();
  await expect(owner.getByTestId("aside-widget-state")).toHaveCount(0);
});
