import { describe, expect, it } from "vitest";

import { defaultPageUrl } from "./TourBuilderPage";

describe("адрес страницы для режима выбора", () => {
  it("подставляет первый разрешённый домен", () => {
    expect(defaultPageUrl(["https://site.example", "https://www.site.example"])).toBe(
      "https://site.example/",
    );
  });

  it("без разрешённых доменов остаётся пустым", () => {
    // Пустой список — рабочее состояние нового проекта (fail closed, §8.1 vision.md).
    expect(defaultPageUrl([])).toBe("");
  });
});
