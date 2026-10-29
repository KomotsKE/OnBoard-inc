import { expect, type Page } from "@playwright/test";

/**
 * Шапка экрана туров (T8.9c): сводка и переключатель формы создания.
 *
 * После T8.10 экран сначала рисует скелет, поэтому все чтения ждут его ухода,
 * а не фиксированной паузы.
 */

export interface ToursSummary {
  tours: number;
  published: number;
  runs: number;
}

const SUMMARY = /^(\d+) тур\S*\s*·\s*(\d+) опубликован\S*\s*·\s*(\d+) запуск\S* за 7 дней$/;

/**
 * Числа из сводки. Склонение («1 тур», «2 тура») тест не закрепляет:
 * ему важны числа, а не окончания.
 */
export async function readSummary(page: Page): Promise<ToursSummary> {
  await expect(page.getByTestId("skeleton")).toHaveCount(0);
  const summary = page.getByTestId("tours-summary");
  await expect(summary).toHaveText(SUMMARY);
  const match = SUMMARY.exec(((await summary.textContent()) ?? "").trim());
  if (!match) {
    throw new Error("сводка не разобрана");
  }
  return { tours: Number(match[1]), published: Number(match[2]), runs: Number(match[3]) };
}

/** Открыть форму создания у непустого списка: фокус уходит в поле названия. */
export async function openNewTourForm(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Новый тур", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByLabel("Название нового тура")).toBeFocused();
}
