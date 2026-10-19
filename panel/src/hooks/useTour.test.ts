import { describe, expect, it } from "vitest";

import type { Step } from "../api/tours";
import { reindex } from "./useTour";

function step(id: string, position: number): Step {
  return { id, position, selector: `#${id}`, title: id, body: "текст", placement: "auto" };
}

describe("оптимистичная перестановка", () => {
  const steps = [step("a", 0), step("b", 1), step("c", 2)];

  it("ставит шаги в заданном порядке и пересчитывает позиции", () => {
    // Порядок пользователь видит сразу, до ответа сервера.
    expect(reindex(steps, ["c", "a", "b"])).toEqual([
      { ...step("c", 0) },
      { ...step("a", 1) },
      { ...step("b", 2) },
    ]);
  });

  it("не придумывает шаги, которых нет", () => {
    // Список мог устареть: лишний идентификатор не должен ломать отрисовку.
    expect(reindex(steps, ["b", "нет-такого", "a"]).map((item) => item.id)).toEqual(["b", "a"]);
  });
});
