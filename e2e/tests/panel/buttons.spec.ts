import { type Locator } from "@playwright/test";

import { asOwner, standProject } from "../../demo-api";
import { expect, test } from "./owner-session";
import { MENU_TESTID, chooseInMenu, openRowMenu } from "./tour-menu";

/**
 * Единый вид действий (T8.8).
 *
 * Обходятся все дети контейнера, а не кнопки по подписям: набор действий строки
 * будет меняться (T8.9), а требование к их виду — нет. Ссылка-имя тура
 * (`.table__title`) сюда не входит намеренно: она остаётся ссылкой.
 */

const MIN_HEIGHT = 36;

interface Metrics {
  label: string;
  tag: string;
  height: number;
  radius: number;
  hasBorder: boolean;
  hasBackground: boolean;
  display: string;
}

async function measure(container: Locator): Promise<Metrics[]> {
  const actions = container.locator("a, button");
  expect(await actions.count()).toBeGreaterThan(0);
  return actions.evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      // Рамка шириной 1px с прозрачным цветом на экране не видна.
      const borderColor = style.borderTopColor.replace(/\s+/g, "");
      const borderVisible =
        borderColor !== "transparent" &&
        !/^rgba\(.*,0(\.0+)?\)$/.test(borderColor) &&
        !/\/0(\.0+)?\)$/.test(borderColor);
      return {
        label: (node.textContent ?? "").trim(),
        tag: node.tagName,
        height: Math.round(node.getBoundingClientRect().height),
        radius: parseFloat(style.borderTopLeftRadius),
        hasBorder:
          parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none" && borderVisible,
        hasBackground:
          style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent",
        display: style.display,
      };
    }),
  );
}

function expectUniformButtons(items: Metrics[]): void {
  for (const item of items) {
    expect(item.height, `«${item.label}»: высота`).toBeGreaterThanOrEqual(MIN_HEIGHT);
    expect(item.radius, `«${item.label}»: радиус`).toBeGreaterThan(0);
    expect(item.hasBorder || item.hasBackground, `«${item.label}»: рамка или фон`).toBe(true);
    if (item.tag === "A") {
      expect(item.display, `«${item.label}»: ссылка не должна быть inline`).not.toBe("inline");
    }
  }
  expect(new Set(items.map((item) => item.height)).size, `высоты: ${items.map((i) => i.height)}`).toBe(1);
}

test("действия строки таблицы туров одного вида", async ({ owner }) => {
  const { id } = await standProject(await asOwner());
  await owner.goto(`/projects/${id}/tours`);
  const row = owner.locator('[data-testid="tour-row"]').first();
  await expect(row).toBeVisible();

  expectUniformButtons(await measure(row.locator(".table__actions")));

  // Пункты меню «Ещё» живут в портале, а не в строке, и единый вид (T8.8)
  // должны иметь так же. Проверка здесь, а не рядом с `tour-menu.ts`: `measure`
  // и `expectUniformButtons` локальны для этого файла, а лишний заход в
  // приложение упирается в лимит обновлений токена.
  await openRowMenu(owner, row);
  expectUniformButtons(await measure(owner.getByTestId(MENU_TESTID)));
});

test("кнопки подтверждения удаления тура того же вида", async ({ owner }) => {
  const { id } = await standProject(await asOwner());
  await owner.goto(`/projects/${id}/tours`);
  const row = owner.locator('[data-testid="tour-row"]').first();
  await chooseInMenu(owner, row, "button", "Удалить");
  const confirm = row.locator('[data-testid="tour-confirm"]');
  await expect(confirm).toBeVisible();

  expectUniformButtons(await measure(confirm));
});

test("действия карточки проекта одного вида", async ({ owner }) => {
  await owner.goto("/projects");
  const card = owner.locator('[data-testid="project-card"]').first();
  await expect(card).toBeVisible();

  expectUniformButtons(await measure(card.locator(".projects__links")));
});
