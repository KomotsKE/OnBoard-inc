import { type APIRequestContext } from "@playwright/test";

import { asOwner, standProject } from "../../demo-api";
import { STAND_URL } from "../../urls";
import { expect, test } from "./owner-session";

/**
 * Связка конструктора с режимом выбора на сайте (T5.5).
 *
 * Сценарий идёт ровно тем путём, которым пойдёт владелец: кнопка в
 * конструкторе, выбор элемента в соседней вкладке, возврат в панель. Тур
 * создаётся свой — демо-туры читают другие сценарии.
 */

async function freshTour(api: APIRequestContext): Promise<[string, string]> {
  const { id: projectId } = await standProject(api);
  const response = await api.post(`/v1/projects/${projectId}/tours`, {
    data: { name: "Сценарий связки" },
  });
  const { id } = (await response.json()) as { id: string };
  return [projectId, id];
}

test("шаг, добавленный на сайте, появляется в конструкторе после возврата", async ({
  owner,
  ownerContext,
}) => {
  const api = await asOwner();
  const [projectId, tourId] = await freshTour(api);

  await owner.goto(`/projects/${projectId}/tours/${tourId}`);
  await expect(owner.getByTestId("steps-empty")).toBeVisible();

  await owner.getByLabel("Страница сайта, на которой выбирать элементы").fill(`${STAND_URL}/reports`);
  const opened = ownerContext.waitForEvent("page");
  await owner.getByRole("button", { name: "Выбрать на сайте" }).click();
  const site = await opened;

  // На сайте: выбираем кнопку и описываем шаг.
  await expect(site.locator('[data-part="panel"]')).toBeVisible();
  await site.getByTestId("filters-button").click();
  await site.locator('[data-part="step-body"]').fill("Здесь настраиваются фильтры");
  await site.locator('[data-part="step-title"]').fill("Фильтры");
  await site.getByRole("button", { name: "Добавить шаг" }).click();
  await expect(site.locator('[data-part="step"]')).toHaveCount(1);
  await site.close();

  // Возврат во вкладку панели: список обновляется сам, без перезагрузки.
  //
  // Headless Chromium не гасит вкладки — страницы одного контекста остаются
  // видимыми и в фокусе, поэтому ни `visibilitychange`, ни `focus` сами не
  // приходят. Посылаем ровно то событие, которое браузер шлёт при возврате
  // в окно; вся остальная цепочка — настоящая.
  await owner.bringToFront();
  await owner.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(owner.getByTestId("step-item")).toHaveCount(1);
  await expect(owner.getByTestId("step-item")).toContainText("Фильтры");
});

test("без разрешённого домена кнопки нет, а есть подсказка", async ({ owner }) => {
  const api = await asOwner();
  const project = await api.post("/v1/projects", { data: { name: "Проект без домена" } });
  const { id: projectId } = (await project.json()) as { id: string };
  const tour = await api.post(`/v1/projects/${projectId}/tours`, { data: { name: "Пустой" } });
  const { id: tourId } = (await tour.json()) as { id: string };

  await owner.goto(`/projects/${projectId}/tours/${tourId}`);

  await expect(owner.getByTestId("pick-no-origins")).toBeVisible();
  await expect(owner.getByTestId("pick-on-site")).toHaveCount(0);

  await api.delete(`/v1/projects/${projectId}`);
});
