import { defineConfig, devices } from "@playwright/test";

import { PANEL_URL, STAND_URL } from "./urls";

/**
 * Сквозные сценарии идут против стенда `testsite/`, никогда против внешних
 * сайтов (§7 docs/conventions.md).
 *
 * Стек поднимает `make e2e`, а не Playwright: конфиг, который сам управляет
 * docker, при падении сценария оставляет стек в непонятном состоянии, и первый
 * же вопрос «а что сейчас запущено» становится нерешаемым.
 */
export default defineConfig({
  testDir: "tests",
  // Ретраев нет намеренно: стенд локальный, флака здесь означает настоящую
  // гонку в виджете, и прятать её повтором — худшее, что можно сделать.
  retries: 0,
  // Воркеров немного: каждый открывает свою сессию владельца, а вход расходует
  // настоящий лимит попыток (§9.2 docs/vision.md).
  workers: 3,
  forbidOnly: true,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
  // Две цели с разными адресами: виджет живёт на стенде, панель — на своём
  // dev-сервере. Один общий baseURL заставил бы половину тестов писать
  // абсолютные адреса.
  projects: [
    {
      name: "widget",
      testMatch: /tests\/widget\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: STAND_URL },
    },
    {
      name: "panel",
      testMatch: /tests\/panel\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: PANEL_URL },
    },
  ],
});
