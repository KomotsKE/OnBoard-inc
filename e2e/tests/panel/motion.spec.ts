import { type Page } from "@playwright/test";

import { expect, test } from "./owner-session";
import { chooseInMenu } from "./tour-menu";

/**
 * Движение интерфейса (T8.10).
 *
 * Заход в приложение один на весь файл, и это не случайно: каждая загрузка
 * страницы тратит лимит обновления токена (REFRESH_BY_IP = 60 в минуту, пачка
 * панели уже у его края), а `reload` ещё и выбрасывает на вход — refresh-токен
 * одноразовый (ADR-0008). Поэтому экраны обходятся переходами внутри SPA, а
 * `prefers-reduced-motion` переключается `emulateMedia` на той же странице,
 * а не новым контекстом с новым входом.
 */

const SKELETON = '[data-testid="skeleton"]';

function nav(page: Page, name: string) {
  return page.locator('[data-testid="project-nav"]').getByRole("link", { name }).click();
}

/** Держит ответы данных, пока тест их не отпустит; вход и сессию не трогает. */
async function holdData(page: Page): Promise<{ release: () => void }> {
  let release: () => void = () => {};
  let gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "GET" && !/^\/v1\/(auth\/|me$)/.test(path)) {
      await gate;
    }
    await route.continue();
  });
  return {
    release: () => {
      release();
      gate = new Promise<void>((resolve) => (release = resolve));
    },
  };
}

async function expectSkeletonThenContent(
  page: Page,
  hold: { release: () => void },
  statusText: RegExp,
  content: () => ReturnType<Page["locator"]>,
): Promise<void> {
  await expect(page.locator(SKELETON)).toBeVisible();
  await expect(page.locator(SKELETON)).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(`${SKELETON} [role="status"]`)).toHaveText(statusText);
  await expect(content()).toHaveCount(0);

  hold.release();
  await expect(content()).toBeVisible();
  await expect(page.locator(SKELETON)).toHaveCount(0);
}

/** Всё, что в этот момент анимируется или переходит. */
async function motionNow(page: Page): Promise<{ animations: string[]; buttonTransition: string }> {
  return page.evaluate(() => {
    const btn = document.querySelector(".btn");
    return {
      animations: document
        .getAnimations()
        .map((a) => (a instanceof CSSAnimation ? `anim:${a.animationName}` : `trans:${(a as CSSTransition).transitionProperty}`)),
      buttonTransition: btn ? getComputedStyle(btn).transitionDuration : "нет .btn",
    };
  });
}

const NO_TRANSITION = /^0s(, 0s)*$/;

test("скелет виден до ответа API и исчезает после на каждом экране; при reduced-motion ничего не анимируется", async ({ owner }) => {
  const hold = await holdData(owner);

  // Запрет движения включён до загрузки: замер идёт на самом первом скелете.
  await owner.emulateMedia({ reducedMotion: "reduce" });
  await owner.goto("/projects");
  await expect(owner.locator(SKELETON)).toBeVisible();
  await expect(owner.locator(`${SKELETON} [role="status"]`)).toHaveText(/Загружаем проекты/);
  await expect(owner.locator('[data-testid="project-card"]')).toHaveCount(0);
  const reduced = await motionNow(owner);
  expect(reduced.animations).toEqual([]);
  expect(reduced.buttonTransition).toMatch(NO_TRANSITION);
  hold.release();
  await expect(owner.locator(SKELETON)).toHaveCount(0);

  // Контроль: тот же замер без запрета видит движение, иначе проверка выше
  // зелена всегда. Тот же скелет — следующий экран, туры.
  await owner.emulateMedia({ reducedMotion: "no-preference" });
  await owner.locator('[data-testid="project-card"]').filter({ hasText: "Отчётница" })
    .getByRole("link", { name: "Туры", exact: true }).click();
  await expect(owner.locator(SKELETON)).toBeVisible();
  await expect(owner.locator(`${SKELETON} [role="status"]`)).toHaveText(/Загружаем туры/);
  await expect(owner.getByTestId("tour-row")).toHaveCount(0);
  const normal = await motionNow(owner);
  expect(normal.animations.length).toBeGreaterThan(0);
  expect(normal.buttonTransition).not.toMatch(NO_TRANSITION);
  hold.release();
  await expect(owner.getByTestId("tour-row").first()).toBeVisible();
  await expect(owner.locator(SKELETON)).toHaveCount(0);

  // Воронка и конструктор берут данные тура из одного кэша, поэтому у них разные туры:
  // у уже виденного тура скелета не будет, и это правильно.
  // Воронка
  await chooseInMenu(owner, owner.getByTestId("tour-row").nth(1), "link", "Аналитика");
  await expectSkeletonThenContent(owner, hold, /Загружаем воронку/, () =>
    owner.getByTestId("range-7d"),
  );

  // Установка: проект (его читают и «Оформление», и конструктор) пока не в кэше.
  await nav(owner, "Установка");
  await expectSkeletonThenContent(owner, hold, /Загружаем проект/, () => owner.getByTestId("snippet"));

  // Конструктор: тур, которого ещё не открывали
  await nav(owner, "Туры");
  await owner.getByTestId("tour-row").first().getByRole("link", { name: "Открыть" }).click();
  await expectSkeletonThenContent(owner, hold, /Загружаем тур/, () => owner.getByTestId("tour-settings"));

  // Оформление: другой проект, значит, его самого в кэше тоже нет.
  await owner.getByTestId("project-switcher").selectOption({ label: "Второй сайт" });
  await expect(owner.locator(SKELETON)).toBeVisible();
  hold.release();
  await expect(owner.locator(SKELETON)).toHaveCount(0);
  await nav(owner, "Оформление");
  await expectSkeletonThenContent(owner, hold, /Загружаем оформление/, () => owner.getByTestId("branding-form"));
});
