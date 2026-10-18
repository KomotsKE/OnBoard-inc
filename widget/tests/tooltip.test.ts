// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ARROW,
  createTooltip,
  GAP,
  MARGIN,
  MOBILE_MAX_WIDTH,
  place,
  type Rect,
} from "../src/core/tooltip";

const VIEWPORT = { width: 1000, height: 800 };
const TIP = { width: 300, height: 150 };

function target(box: Partial<Rect>): Rect {
  return { left: 400, top: 300, width: 100, height: 40, ...box };
}

describe("выбор стороны", () => {
  it("по умолчанию становится снизу", () => {
    const result = place(target({}), TIP, VIEWPORT, "auto");

    expect(result).toMatchObject({ mode: "anchored", side: "bottom" });
    if (result.mode === "anchored") {
      expect(result.top).toBe(300 + 40 + GAP);
    }
  });

  it("разворачивается наверх, когда снизу места нет", () => {
    // Цель у нижнего края: ниже помещается только край экрана.
    const result = place(target({ top: 700 }), TIP, VIEWPORT, "auto");

    expect(result).toMatchObject({ mode: "anchored", side: "top" });
  });

  it("уходит вбок, когда нет места ни снизу, ни сверху", () => {
    const squat = { width: 1000, height: 200 };
    const result = place(target({ top: 80, height: 40 }), TIP, squat, "auto");

    expect(result).toMatchObject({ mode: "anchored", side: "right" });
  });

  it("уважает сторону из настроек шага", () => {
    const result = place(target({}), TIP, VIEWPORT, "left");

    expect(result).toMatchObject({ mode: "anchored", side: "left" });
  });

  it("разворачивает заданную сторону, если там не помещается", () => {
    // Шаг просит «сверху», но цель прижата к верхнему краю.
    const result = place(target({ top: 20 }), TIP, VIEWPORT, "top");

    expect(result).toMatchObject({ mode: "anchored", side: "bottom" });
  });

  it("когда не помещается нигде, берёт сторону с наибольшим запасом", () => {
    // Экран выше порога мобильной раскладки, но подсказке мало места со всех сторон.
    const tiny = { width: 520, height: 220 };
    const result = place(target({ left: 10, top: 90, width: 400, height: 40 }), TIP, tiny, "auto");

    expect(result.mode).toBe("anchored");
    if (result.mode === "anchored") {
      // Подсказка всё равно остаётся на экране.
      expect(result.left).toBeGreaterThanOrEqual(MARGIN);
      expect(result.top).toBeGreaterThanOrEqual(MARGIN);
    }
  });
});

describe("сдвиг вдоль экрана", () => {
  it("центрируется на цели, когда места хватает", () => {
    const result = place(target({ left: 400, width: 100 }), TIP, VIEWPORT, "bottom");

    if (result.mode !== "anchored") {
      throw new Error("ожидалась привязка к цели");
    }
    expect(result.left).toBe(450 - TIP.width / 2);
  });

  it("не вылезает за левый край", () => {
    const result = place(target({ left: 0, width: 40 }), TIP, VIEWPORT, "bottom");

    if (result.mode !== "anchored") {
      throw new Error("ожидалась привязка к цели");
    }
    expect(result.left).toBe(MARGIN);
  });

  it("не вылезает за правый край", () => {
    const result = place(target({ left: 980, width: 20 }), TIP, VIEWPORT, "bottom");

    if (result.mode !== "anchored") {
      throw new Error("ожидалась привязка к цели");
    }
    expect(result.left).toBe(VIEWPORT.width - TIP.width - MARGIN);
  });
});

describe("носик", () => {
  it("смотрит на центр цели", () => {
    const result = place(target({ left: 400, width: 100 }), TIP, VIEWPORT, "bottom");

    if (result.mode !== "anchored") {
      throw new Error("ожидалась привязка к цели");
    }
    expect(result.arrowLeft).toBe(450 - ARROW / 2);
    expect(result.arrowTop).toBe(result.top - ARROW / 2);
  });

  it("не сползает с подсказки у края экрана", () => {
    const result = place(target({ left: 0, width: 20 }), TIP, VIEWPORT, "bottom");

    if (result.mode !== "anchored") {
      throw new Error("ожидалась привязка к цели");
    }
    // У скруглённого угла носику делать нечего.
    expect(result.arrowLeft).toBeGreaterThanOrEqual(result.left);
    expect(result.arrowLeft).toBeLessThanOrEqual(result.left + TIP.width - ARROW);
  });
});

describe("узкий экран", () => {
  it("превращается в панель у нижнего края", () => {
    const phone = { width: 375, height: 667 };

    expect(place(target({}), TIP, phone, "auto")).toEqual({ mode: "sheet" });
  });

  it("граница — 480 px", () => {
    expect(place(target({}), TIP, { width: MOBILE_MAX_WIDTH, height: 800 }, "auto").mode).toBe(
      "anchored",
    );
    expect(place(target({}), TIP, { width: MOBILE_MAX_WIDTH - 1, height: 800 }, "auto").mode).toBe(
      "sheet",
    );
  });
});

describe("подсказка в shadow root", () => {
  const LABELS = { next: "Далее", skip: "Пропустить", done: "Готово" };

  function mount(handlers = { onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn() }) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const tooltip = createTooltip(root, LABELS, handlers);
    const element = document.createElement("button");
    document.body.append(element);
    return { root, tooltip, element, handlers };
  }

  function part(root: ShadowRoot, name: string): HTMLElement {
    const node = root.querySelector<HTMLElement>(`[data-part="${name}"]`);
    if (!node) {
      throw new Error(`в подсказке нет части ${name}`);
    }
    return node;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("показывает текст шага как текст, а не как разметку", () => {
    const { root, tooltip, element } = mount();

    tooltip.show(
      { title: "Шаг", body: '<img src=x onerror=alert(1)>', placement: "auto" },
      element,
      { index: 0, total: 1 },
    );

    // Текст шага пишет владелец сайта, и он не должен стать разметкой на
    // странице посетителя (инвариант №6).
    expect(root.querySelector("img")).toBeNull();
    expect(part(root, "body").textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it("на последнем шаге кнопка называется «Готово»", () => {
    const { root, tooltip, element } = mount();

    tooltip.show({ title: "", body: "Текст", placement: "auto" }, element, { index: 2, total: 3 });

    expect(part(root, "next").textContent).toBe("Готово");
  });

  it("на промежуточном шаге — «Далее»", () => {
    const { root, tooltip, element } = mount();

    tooltip.show({ title: "", body: "Текст", placement: "auto" }, element, { index: 0, total: 3 });

    expect(part(root, "next").textContent).toBe("Далее");
  });

  it("показывает прогресс точками", () => {
    const { root, tooltip, element } = mount();

    tooltip.show({ title: "", body: "Текст", placement: "auto" }, element, { index: 1, total: 4 });

    const dots = [...part(root, "dots").children];
    expect(dots).toHaveLength(4);
    expect(dots.findIndex((dot) => (dot as HTMLElement).dataset.current !== undefined)).toBe(1);
  });

  it("кнопки зовут обработчики", () => {
    const handlers = { onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn() };
    const { root, tooltip, element } = mount(handlers);
    tooltip.show({ title: "", body: "Текст", placement: "auto" }, element, { index: 0, total: 2 });

    part(root, "next").click();
    part(root, "skip").click();
    part(root, "back").click();

    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onSkip).toHaveBeenCalledTimes(1);
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it("на первом шаге «Назад» не показывается", () => {
    const { root, tooltip, element } = mount();

    tooltip.show({ title: "", body: "Текст", placement: "auto" }, element, { index: 0, total: 3 });
    const first = part(root, "back").hidden;
    tooltip.show({ title: "", body: "Текст", placement: "auto" }, element, { index: 1, total: 3 });

    expect([first, part(root, "back").hidden]).toEqual([true, false]);
  });

  it("stop убирает подсказку", () => {
    const { root, tooltip, element } = mount();
    tooltip.show({ title: "", body: "Текст", placement: "auto" }, element, { index: 0, total: 1 });

    tooltip.stop();

    expect(root.querySelector('[data-part="tip"]')).toBeNull();
  });
});
