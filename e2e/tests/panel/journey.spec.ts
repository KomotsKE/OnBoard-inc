import { expect, test, type Page } from "@playwright/test";

import { STAND_URL } from "../../urls";

/**
 * Сквозной путь (T3.6): регистрация → проект → сниппет → тур → проход тура
 * на чужой странице.
 *
 * Это пункт приёмки A1 в автоматическом виде: один тег на странице, про
 * которую мы ничего не знаем, даёт работающий тур. Поэтому сниппет берётся
 * с экрана установки как текст и вставляется на страницу стенда ровно так,
 * как это сделал бы разработчик клиента, — с ключом только что созданного
 * проекта, а не с заранее прошитым в стенд.
 */

const PASSWORD = "очень-длинный-пароль-владельца";
// Страница без тега виджета: на остальных страницах стенда он уже стоит,
// и второй сниппет корректно не запустится — `window.OnBoard` занят.
const TOUR_PATH = "/clean.html";

function uniqueEmail(): string {
  return `journey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/** Вставляет сниппет на страницу: те же атрибуты, что дала панель. */
async function installSnippet(stand: Page, snippet: string): Promise<void> {
  await stand.evaluate((text) => {
    const template = document.createElement("template");
    template.innerHTML = text;
    const source = template.content.querySelector("script");
    if (!source) {
      throw new Error("в сниппете нет тега script");
    }
    // Скрипт из innerHTML не исполняется — создаём настоящий элемент
    // и переносим атрибуты один в один.
    const script = document.createElement("script");
    for (const attribute of Array.from(source.attributes)) {
      script.setAttribute(attribute.name, attribute.value);
    }
    document.body.append(script);
  }, snippet);
}

test("от регистрации до пройденного тура на чужой странице", async ({ page }) => {
  const email = uniqueEmail();
  const project = `Сквозная ${Date.now().toString().slice(-6)}`;

  // 1. Регистрация: новый владелец, пустой кабинет.
  await page.goto("/register");
  await page.getByLabel("Почта").fill(email);
  await page.getByLabel("Пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId("projects-empty")).toBeVisible();

  // 2. Проект и разрешённый домен.
  await page.getByLabel("Название нового проекта").fill(project);
  await page.getByRole("button", { name: "Создать" }).click();
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: project });
  await card.getByRole("link", { name: "Установка", exact: true }).click();
  await page.getByLabel("Адрес сайта").fill(STAND_URL);
  await page.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByTestId("origins")).toContainText(STAND_URL);

  // 3. Сниппет — тот самый текст, который владелец отдаёт разработчику.
  const snippet = (await page.getByTestId("snippet").textContent()) ?? "";
  expect(snippet).toContain("data-key=\"pk_");

  // 4. Тур из двух шагов по элементам чужой страницы.
  await page.goto("/projects");
  await card.getByRole("link", { name: "Туры", exact: true }).click();
  await page.getByLabel("Название нового тура").fill("Знакомство");
  await page.getByRole("button", { name: "Создать" }).click();
  await page
    .locator('[data-testid="tour-row"]')
    .filter({ hasText: "Знакомство" })
    .getByRole("link", { name: "Конструктор" })
    .click();

  await page.getByLabel("Условие").selectOption("exact");
  await page.getByLabel("Значение условия показа").fill(TOUR_PATH);
  await page.getByTestId("tour-settings").getByRole("button", { name: "Сохранить" }).click();

  for (const [selector, text] of [
    ['[data-testid="brand"]', "Это название сайта"],
    ['[data-testid="filters-button"]', "А здесь фильтры"],
  ]) {
    await page.getByLabel("Новый шаг: селектор и текст").fill(selector);
    await page.getByLabel("Текст нового шага").fill(text);
    await page.getByRole("button", { name: "Добавить шаг" }).click();
    await expect(page.getByTestId("step-item").filter({ hasText: selector })).toHaveCount(1);
  }

  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(page.getByText("Опубликован")).toBeVisible();

  // 5. Чужая страница: вставляем тег и проходим тур целиком.
  const stand = await page.context().newPage();
  await stand.goto(`${STAND_URL}${TOUR_PATH}`);
  await installSnippet(stand, snippet);

  await expect(stand.locator('[data-part="tip"]')).toBeVisible();
  await expect(stand.locator('[data-part="body"]')).toHaveText("Это название сайта");
  await stand.locator('[data-part="next"]').click();
  await expect(stand.locator('[data-part="body"]')).toHaveText("А здесь фильтры");

  // Последний шаг — «Готово»: тур закрывается, страница остаётся как была.
  await expect(stand.locator('[data-part="next"]')).toHaveText("Готово");
  await stand.locator('[data-part="next"]').click();
  await expect(stand.locator('[data-onboard="host"]')).toHaveCount(0);
  await stand.close();

  // 6. Прибираем за собой: удаление проекта уносит тур каскадом.
  await page.goto("/projects");
  await card.getByRole("button", { name: "Удалить" }).click();
  await card.getByLabel(`Подтверждение удаления проекта ${project}`).fill(project);
  await card.getByRole("button", { name: "Удалить навсегда" }).click();
  await expect(card).toHaveCount(0);
});
