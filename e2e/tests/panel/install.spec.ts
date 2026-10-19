import { expect, test, type Page } from "@playwright/test";

import { DEMO_EMAIL, DEMO_PASSWORD } from "./demo-owner";

/**
 * Экран установки (T3.3).
 *
 * Проверяется переход, ради которого экран и существует: «виджет ещё не найден»
 * → виджет загрузился на разрешённом домене → «подключён». Запрос конфига
 * делается со страницы стенда, то есть с настоящим `Origin`, — отметку о
 * подключении ставит именно он.
 *
 * Проект создаётся свой: демо-проект стенда трогают сценарии виджета, и
 * зависеть от порядка запуска нельзя.
 */

const STAND = "http://localhost:8080";
const API = "http://localhost:8000";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Почта").fill(DEMO_EMAIL);
  await page.getByLabel("Пароль").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

/**
 * Запрос конфига со страницы стенда: ровно то, что делает загрузчик.
 *
 * Отказ возвращается как «отказ», а не кодом: заголовков CORS на ответах с
 * ошибкой нет намеренно (§8.1 docs/vision.md), поэтому браузер не даёт их
 * прочитать — с точки зрения чужой страницы это просто неудача.
 */
async function askConfigFromStand(page: Page, key: string): Promise<number | "отказ"> {
  const stand = await page.context().newPage();
  await stand.goto(`${STAND}/settings`);
  const status = await stand.evaluate(
    async ([api, publicKey]) => {
      try {
        const response = await fetch(
          `${api}/v1/public/config?key=${publicKey}&url=${encodeURIComponent("/settings")}`,
        );
        return response.status;
      } catch {
        return "отказ" as const;
      }
    },
    [API, key] as const,
  );
  await stand.close();
  return status;
}

test("статус подключения меняется после загрузки виджета на разрешённом домене", async ({
  page,
}) => {
  // Имя без слова «Установка»: getByRole ищет имя подстрокой, и ссылка
  // карточки совпала бы со ссылкой «Установка» на той же карточке.
  const name = `Сайт ${Date.now().toString().slice(-6)}`;
  await signIn(page);
  await page.getByLabel("Название нового проекта").fill(name);
  await page.getByRole("button", { name: "Создать" }).click();

  const card = page.locator('[data-testid="project-card"]').filter({ hasText: name });
  await card.getByRole("link", { name: "Установка", exact: true }).click();

  // Новый проект: ключ в сниппете, доменов нет, виджета никто не видел.
  await expect(page.getByTestId("widget-status")).toContainText("ещё не найден");
  await expect(page.getByTestId("origins-empty")).toBeVisible();
  const snippet = (await page.getByTestId("snippet").textContent()) ?? "";
  const key = /data-key="(pk_[0-9a-f]{32})"/.exec(snippet)?.[1] ?? "";
  expect(key).toMatch(/^pk_[0-9a-f]{32}$/);

  // Пока домен не разрешён, конфиг отвечает отказом — и статус не меняется.
  expect(await askConfigFromStand(page, key)).toBe("отказ");
  await page.reload();
  await expect(page.getByTestId("widget-status")).toContainText("ещё не найден");

  await page.getByLabel("Адрес сайта").fill(STAND);
  await page.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByTestId("origins")).toContainText(STAND);

  expect(await askConfigFromStand(page, key)).toBe(200);
  await page.reload();
  await expect(page.getByTestId("widget-status")).toContainText("подключён");

  // Прибираем за собой: у владельца не больше десяти проектов.
  await page.goto("/projects");
  const created = page.locator('[data-testid="project-card"]').filter({ hasText: name });
  await created.getByRole("button", { name: "Удалить" }).click();
  await created.getByLabel(`Подтверждение удаления проекта ${name}`).fill(name);
  await created.getByRole("button", { name: "Удалить навсегда" }).click();
  await expect(created).toHaveCount(0);
});

test("блок для разработчика показывает домены для CSP", async ({ page }) => {
  await signIn(page);
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: "Отчётница" });
  await card.getByRole("link", { name: "Установка", exact: true }).click();

  const technical = page.getByTestId("technical");
  await technical.getByText("Для вашего разработчика и службы безопасности").click();

  // Службе безопасности нужны оба адреса: откуда файлы и куда запросы.
  await expect(technical).toContainText("script-src http://localhost:8080");
  await expect(technical).toContainText("connect-src http://localhost:8000");
  await expect(technical).toContainText("Ни одной cookie");
});
