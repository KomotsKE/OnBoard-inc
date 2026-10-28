import { type Page } from "@playwright/test";

import { API_URL, STAND_URL } from "../../urls";
import { expect, test } from "./owner-session";
import { chooseInMenu } from "./tour-menu";

/**
 * Конструктор тура (T3.5).
 *
 * Сценарий собирает тур из трёх шагов руками, меняет порядок перетаскиванием
 * и проверяет, что виджет видит именно то, что собрали. Порядок шагов
 * сверяется через публичный конфиг — тем же запросом, который делает
 * загрузчик на сайте клиента.
 *
 * Перетаскивание выполняется с клавиатуры: это и надёжнее эмуляции мыши,
 * и проверяет, что собрать тур можно без мыши вообще.
 */

const PATH = "/builder-check";

/** Заголовки шагов тура глазами виджета. */
async function stepsFromConfig(page: Page, key: string): Promise<string[]> {
  const stand = await page.context().newPage();
  await stand.goto(`${STAND_URL}/settings`);
  const titles = await stand.evaluate(
    async ([api, publicKey, url]) => {
      const response = await fetch(
        `${api}/v1/public/config?key=${publicKey}&url=${encodeURIComponent(url)}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as { tour: { steps: { title: string }[] } | null };
      return body.tour?.steps.map((step) => step.title) ?? [];
    },
    [api(), key, PATH] as const,
  );
  await stand.close();
  return titles;
}

function api(): string {
  return API_URL;
}

async function addStep(page: Page, selector: string, text: string): Promise<void> {
  await page.getByLabel("Новый шаг: селектор и текст").fill(selector);
  await page.getByLabel("Текст нового шага").fill(text);
  await page.getByRole("button", { name: "Добавить шаг" }).click();
  await expect(page.getByTestId("step-item").filter({ hasText: selector })).toHaveCount(1);
}

async function setTitle(page: Page, position: number, title: string): Promise<void> {
  await page.getByTestId("step-item").nth(position).getByRole("button").nth(1).click();
  await page.getByLabel("Заголовок").fill(title);
  // Кнопок «Сохранить» на экране две: у формы шага и у условия показа.
  await page.getByTestId("step-form").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByTestId("step-item").nth(position)).toContainText(title);
}

test("тур из трёх шагов: сборка, порядок перетаскиванием, видимость в виджете", async ({
  owner: page,
}) => {
  const name = `Сборка ${Date.now().toString().slice(-6)}`;

  // Тур создаётся в списке и открывается в конструкторе.
  await page.goto("/projects");
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: "Отчётница" });
  await card.getByRole("link", { name: "Туры", exact: true }).click();
  await page.getByLabel("Название нового тура").fill(name);
  await page.getByRole("button", { name: "Создать" }).click();
  const row = page.locator('[data-testid="tour-row"]').filter({ hasText: name });
  await row.getByRole("link", { name: "Открыть", exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // Условие показа — отдельный адрес, чтобы не пересекаться с другими турами.
  await page.getByLabel("Условие").selectOption("exact");
  await page.getByLabel("Значение условия показа").fill(PATH);
  await page.getByTestId("tour-settings").getByRole("button", { name: "Сохранить" }).click();

  await addStep(page, '[data-testid="brand"]', "Шапка сайта");
  await addStep(page, '[data-testid="nav-reports"]', "Переход к отчётам");
  await addStep(page, '[data-testid="filters-button"]', "Фильтры");
  await setTitle(page, 0, "Первый");
  await setTitle(page, 1, "Второй");
  await setTitle(page, 2, "Третий");

  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(page.getByText(/опубликован/i).first()).toBeVisible();

  const key = "pk_00000000000000000000000000000001";
  expect(await stepsFromConfig(page, key)).toEqual(["Первый", "Второй", "Третий"]);

  // Перетаскивание с клавиатуры: пробел берёт шаг, стрелка двигает, пробел кладёт.
  // Перед этим список должен устояться: перерисовка после публикации, прилетев
  // посреди перетаскивания, отменяет его.
  await expect(page.getByTestId("step-item").first()).toContainText("Первый");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Переместить шаг 1" }).focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(100);
  await page.keyboard.press("Space");
  await expect(page.getByTestId("step-item").first()).toContainText("Второй");

  // Виджет видит новый порядок — значит, он доехал до сервера, а не только
  // до кэша на экране.
  expect(await stepsFromConfig(page, key)).toEqual(["Второй", "Первый", "Третий"]);

  // Прибираем за собой.
  await page.goto(`/projects`);
  await card.getByRole("link", { name: "Туры", exact: true }).click();
  await chooseInMenu(page, row, "button", "Удалить");
  await row.getByTestId("tour-confirm").getByRole("button", { name: "Удалить" }).click();
  await expect(row).toHaveCount(0);
});
