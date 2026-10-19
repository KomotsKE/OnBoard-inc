import { describe, expect, it } from "vitest";

import type { Issue } from "../api/analytics";
import { issueLabel, percent } from "./AnalyticsPage";

function issue(overrides: Partial<Issue>): Issue {
  return {
    type: "step_target_missing",
    step_position: 1,
    selector: "#export",
    error_code: null,
    count: 14,
    ...overrides,
  };
}

describe("проблемы словами", () => {
  it("называет шаг по-человечески и показывает селектор", () => {
    // Владелец чинит вёрстку по селектору, а не по номеру позиции с нуля.
    expect(issueLabel(issue({}))).toBe("Шаг 2: элемент не найден — 14 раз (селектор #export)");
  });

  it("склоняет счёт", () => {
    expect(issueLabel(issue({ count: 1 }))).toContain("1 раз");
    expect(issueLabel(issue({ count: 3 }))).toContain("3 раза");
  });

  it("ошибку виджета показывает с её кодом", () => {
    expect(
      issueLabel(issue({ type: "widget_error", error_code: "render_failed", count: 2 })),
    ).toBe("Ошибка виджета «render_failed» — 2 раза");
  });
});

describe("проценты", () => {
  it("округляются до целых", () => {
    expect([0, 0.544, 1].map(percent)).toEqual(["0 %", "54 %", "100 %"]);
  });
});
