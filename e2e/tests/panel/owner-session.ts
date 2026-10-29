import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";

import { PANEL_URL } from "../../urls";
import { DEMO_EMAIL, DEMO_PASSWORD } from "./demo-owner";

/**
 * Одна сессия владельца на воркер.
 *
 * Вход расходует настоящий лимит — 10 попыток за 5 минут с адреса
 * (§9.2 docs/vision.md). Сценариев панели становится всё больше, и если каждый
 * логинится сам, пачка упирается не в ошибки панели, а в защиту бэкенда.
 *
 * Переиспользовать сессию через `storageState` нельзя: refresh-токен
 * одноразовый и ротируется, второй контекст с той же cookie выглядит как кража
 * (ADR-0008). Поэтому переиспользуется не снимок cookie, а сам контекст
 * браузера — как у живого владельца, открывшего несколько вкладок.
 */

export async function signIn(page: Page): Promise<void> {
  // Первый заход без cookie всё равно получит 401 на обновлении токена, но
  // успеет потратить REFRESH_BY_IP — а пачка панели и так у его границы.
  const noSession = "**/v1/auth/refresh";
  await page.route(noSession, (route) =>
    route.fulfill({ status: 401, contentType: "application/problem+json", body: "{}" }),
  );
  await page.goto("/login");
  await page.getByLabel("Почта").fill(DEMO_EMAIL);
  await page.getByLabel("Пароль").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.unroute(noSession);
}

export const test = base.extend<{ owner: Page }, { ownerContext: BrowserContext }>({
  ownerContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: PANEL_URL });
      const page = await context.newPage();
      await signIn(page);
      await page.close();

      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],

  owner: async ({ ownerContext }, use) => {
    const page = await ownerContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from "@playwright/test";
