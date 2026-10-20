import { describe, expect, it } from "vitest";

import type { TourListItem } from "../api/tours";
import { completionLabel, matchLabel } from "./ToursPage";

function tour(overrides: Partial<TourListItem>): TourListItem {
  return {
    id: "t-1",
    name: "Знакомство",
    status: "published",
    url_match: { mode: "prefix", value: "/reports" },
    show_once: true,
    published_at: null,
    steps_count: 4,
    runs_7d: 0,
    completion_rate_7d: 0,
    ...overrides,
  };
}

describe("условие показа словами", () => {
  it("объясняет каждый режим", () => {
    // `url_match` в сыром виде владелец сайта читать не обязан.
    expect(matchLabel({ mode: "exact", value: "/pricing" })).toBe(
      "адрес страницы ровно «/pricing»",
    );
    expect(matchLabel({ mode: "prefix", value: "/reports" })).toBe(
      "адрес начинается с «/reports»",
    );
    expect(matchLabel({ mode: "contains", value: "plan=pro" })).toBe(
      "адрес содержит «plan=pro»",
    );
    expect(matchLabel({ mode: "regex", value: "^/r/\\d+$" })).toBe(
      "адрес подходит под выражение «^/r/\\d+$»",
    );
  });
});

describe("завершение за 7 дней", () => {
  it("при нуле запусков не показывает ноль процентов", () => {
    // «0 %» при отсутствии запусков — это не результат, а отсутствие данных.
    // В таблице место узкое, поэтому отсутствие данных — прочерк.
    expect(completionLabel(tour({ runs_7d: 0 }))).toBe("—");
  });

  it("показывает долю дошедших до конца", () => {
    // Слова «запусков за 7 дней» ушли в заголовки столбцов: повторять их
    // в каждой строке — шум.
    expect(completionLabel(tour({ runs_7d: 20, completion_rate_7d: 0.6 }))).toBe("60 %");
    expect(completionLabel(tour({ runs_7d: 1, completion_rate_7d: 1 }))).toBe("100 %");
    expect(completionLabel(tour({ runs_7d: 7, completion_rate_7d: 0.355 }))).toBe("36 %");
  });
});
