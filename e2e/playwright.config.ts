import { defineConfig, devices } from "@playwright/test";

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
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
