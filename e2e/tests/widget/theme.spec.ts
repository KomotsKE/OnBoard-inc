import { expect, test, type Page } from "@playwright/test";

import { asOwner, setTheme, standProject, type Theme } from "../../demo-api";

/**
 * Тема оформления в виджете (T6.1).
 *
 * Проверяется то, ради чего тема вообще есть: владелец меняет цвета и
 * подписи у себя в проекте, и подсказка на его сайте меняется — без
 * переустановки сниппета и без новой сборки виджета.
 */

const BRAND = "#A21CAF";
const THEME: Theme = {
  primary_color: BRAND,
  text_color: "#1A2B3C",
  backdrop_opacity: 0.8,
  border_radius: "2px",
  // Не Georgia: ею стенд враждебно переопределяет всё подряд, и соседний
  // сценарий про изоляцию стилей принял бы наш шрифт за протёкший с страницы.
  font_family: '"Courier New", monospace',
  next_label: "Дальше",
  skip_label: "Не сейчас",
  done_label: "Всё понятно",
};

/** Цвет из стиля shadow-элемента: сравнивать удобнее в rgb. */
async function styleOf(page: Page, part: string, property: string): Promise<string> {
  return page.evaluate(
    ([selector, prop]) => {
      const root = document.querySelector('[data-onboard="host"]')?.shadowRoot;
      const node = root?.querySelector(`[data-part="${selector}"]`);
      if (!node) {
        throw new Error(`в виджете нет части ${selector}`);
      }
      return getComputedStyle(node).getPropertyValue(prop);
    },
    [part, property] as const,
  );
}

test("тема проекта доезжает до подсказки на сайте", async ({ page }) => {
  const api = await asOwner();
  const project = await standProject(api);
  const original = project.theme;

  try {
    await setTheme(api, project.id, THEME);

    await page.goto("/reports");
    await expect(page.locator('[data-part="tip"]')).toBeVisible();

    // Рамка подсветки и кнопка — брендовым цветом.
    expect(await page.locator('[data-part="ring-inner"]').getAttribute("stroke")).toBe(BRAND);
    expect(await styleOf(page, "next", "background-color")).toBe("rgb(162, 28, 175)");

    // Затемнение, скругление, шрифт и цвет текста — оттуда же.
    expect(await page.locator('[data-part="backdrop"]').getAttribute("opacity")).toBe("0.8");
    expect(await page.locator('[data-part="hole"]').getAttribute("rx")).toBe("2");
    expect(await styleOf(page, "tip", "font-family")).toContain("Courier New");
    expect(await styleOf(page, "body", "color")).toBe("rgb(26, 43, 60)");

    // Подписи кнопок — тоже часть темы: клиенту может быть нужен свой тон.
    await expect(page.locator('[data-part="next"]')).toHaveText("Дальше");
    await expect(page.locator('[data-part="skip"]')).toHaveText("Не сейчас");
  } finally {
    // Возвращаем как было: демо-данные общие для всех сценариев.
    await setTheme(api, project.id, original);
    await api.dispose();
  }
});

test("на последнем шаге подпись берётся из темы", async ({ page }) => {
  const api = await asOwner();
  const project = await standProject(api);

  try {
    await setTheme(api, project.id, THEME);
    // Тур «Ожидание элемента» состоит из одного шага, он же последний.
    await page.goto("/delayed");
    await expect(page.locator('[data-part="tip"]')).toBeVisible();

    await expect(page.locator('[data-part="next"]')).toHaveText("Всё понятно");
  } finally {
    await setTheme(api, project.id, project.theme);
    await api.dispose();
  }
});
