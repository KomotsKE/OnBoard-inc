import { expect, test, type Page } from "@playwright/test";

import { DEMO_EMAIL, DEMO_PASSWORD } from "./demo-owner";

/**
 * Вход, сессия и выход (T3.1).
 *
 * Сессия держится на двух токенах: access в памяти вкладки, refresh в httpOnly
 * cookie (ADR-0008). Проверяется то, что из этого следует: после F5 владелец
 * остаётся внутри, протухший access обновляется незаметно, выход закрывает
 * доступ.
 *
 * Утверждения собраны в сценарии, а не разложены по отдельным тестам: каждый
 * вход расходует настоящий лимит (§9.2 docs/vision.md), а пересобрать сессию
 * из снимка cookie нельзя — refresh-токен одноразовый (см. demo-owner.ts).
 */

function uniqueEmail(): string {
  return `owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
}

test("жизнь сессии: вход, перезагрузка, протухший токен, выход", async ({ page }) => {
  await page.goto("/login");
  await signIn(page, DEMO_EMAIL, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId("owner-email")).toHaveText(DEMO_EMAIL);

  await page.reload();
  // Экран логина не должен мелькнуть: до ответа показывается сплэш (ADR-0008).
  await expect(page.getByTestId("owner-email")).toHaveText(DEMO_EMAIL);
  await expect(page).toHaveURL(/\/projects$/);

  // Первый запрос «кто я» отвечает 401, будто access-токен истёк.
  let expired = false;
  await page.route("**/v1/me", async (route) => {
    if (expired) {
      await route.continue();
      return;
    }
    expired = true;
    await route.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify({ type: "/errors/unauthorized", title: "Нужна аутентификация" }),
    });
  });
  await page.reload();
  // Владелец этого не заметил: клиент обменял cookie на новый токен и повторил.
  await expect(page.getByTestId("owner-email")).toHaveText(DEMO_EMAIL);
  await page.unroute("**/v1/me");

  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
});

test("приватный адрес уводит на логин и возвращает обратно после входа", async ({ page }) => {
  const wanted = "/projects/00000000-0000-0000-0000-000000000000/install";

  await page.goto(wanted);

  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, DEMO_EMAIL, DEMO_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${wanted}$`));
});

test("регистрация приводит к списку проектов", async ({ page }) => {
  const email = uniqueEmail();

  await page.goto("/register");
  await page.getByLabel("Почта").fill(email);
  await page.getByLabel("Пароль").fill("очень-длинный-пароль-владельца");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();

  // Смотрим на исход, а не только на адрес: отказ сервера (например 429 при
  // исчерпанном лимите регистраций) иначе выглядел бы как загадочный таймаут.
  const error = page.getByTestId("auth-error");
  await expect
    .poll(async () =>
      (await error.isVisible()) ? await error.textContent() : new URL(page.url()).pathname,
    )
    .toBe("/projects");
  await expect(page.getByTestId("owner-email")).toHaveText(email);
  await expect(page.getByRole("heading", { name: "Проекты" })).toBeVisible();
});

test("неверный пароль не говорит, что именно неверно", async ({ page }) => {
  await page.goto("/login");

  await signIn(page, DEMO_EMAIL, "совершенно-другой-пароль");

  await expect(page.getByTestId("auth-error")).toHaveText("Неверный адрес или пароль");
});

test("короткий пароль отклоняется до отправки на сервер", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Почта").fill(uniqueEmail());
  await page.getByLabel("Пароль").fill("коротко");

  await page.getByRole("button", { name: "Создать аккаунт" }).click();

  await expect(page.getByTestId("auth-error")).toBeVisible();
});
