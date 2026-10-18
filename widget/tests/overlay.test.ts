// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { createOverlay, HOLE_PADDING, radiusOf } from "../src/core/overlay";

const THEME = { primaryColor: "#2563EB", backdropOpacity: 0.55, borderRadius: "8px" };

type Box = { left: number; top: number; width: number; height: number };

function shadow(): ShadowRoot {
  const host = document.createElement("div");
  document.body.append(host);
  return host.attachShadow({ mode: "open" });
}

/** jsdom не считает раскладку, поэтому прямоугольник цели задаётся явно. */
function targetWith(box: Box): HTMLElement {
  const element = document.createElement("button");
  document.body.append(element);
  element.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => box,
    }) as DOMRect;
  return element;
}

function boxOf(root: ShadowRoot, part: string): Box & { rx: number } {
  const node = root.querySelector(`[data-part="${part}"]`);
  if (!node) {
    throw new Error(`в оверлее нет части ${part}`);
  }
  return {
    left: Number(node.getAttribute("x")),
    top: Number(node.getAttribute("y")),
    width: Number(node.getAttribute("width")),
    height: Number(node.getAttribute("height")),
    rx: Number(node.getAttribute("rx")),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("вырез", () => {
  it("встаёт вокруг цели с зазором", () => {
    const root = shadow();
    createOverlay(root, THEME).draw(targetWith({ left: 100, top: 50, width: 200, height: 40 }));

    expect(boxOf(root, "hole")).toEqual({ left: 96, top: 46, width: 208, height: 48, rx: 8 });
    expect(HOLE_PADDING).toBe(4);
  });

  it("белая обводка ложится вплотную к брендовой, без щели", () => {
    const root = shadow();
    createOverlay(root, THEME).draw(targetWith({ left: 100, top: 50, width: 200, height: 40 }));

    const inner = boxOf(root, "ring-inner");
    const outer = boxOf(root, "ring-outer");
    // Обводка рисуется по центру контура: брендовая (2) занимает ±1 от своего
    // контура, белая (3) — ±1.5 от своего. Сдвиг на 2.5 ставит их вплотную.
    expect(outer.left).toBe(inner.left - 2.5);
    expect(outer.width).toBe(inner.width + 5);
    expect(root.querySelector('[data-part="ring-inner"]')?.getAttribute("stroke")).toBe("#2563EB");
    expect(root.querySelector('[data-part="ring-outer"]')?.getAttribute("stroke")).toBe("#fff");
  });

  it("берёт затемнение и скругление из темы", () => {
    const root = shadow();
    const overlay = createOverlay(root, {
      primaryColor: "#112233",
      backdropOpacity: 0.3,
      borderRadius: "12px",
    });

    overlay.draw(targetWith({ left: 0, top: 0, width: 10, height: 10 }));

    expect(root.querySelector('[data-part="backdrop"]')?.getAttribute("opacity")).toBe("0.3");
    expect(boxOf(root, "hole").rx).toBe(12);
  });

  it("на непонятном скруглении берёт значение по умолчанию", () => {
    // Тема допускает любую строку до 16 символов, геометрии SVG нужны пиксели.
    expect(radiusOf("0.5rem")).toBe(8);
    expect(radiusOf("12px")).toBe(12);
  });

  it("у схлопнутого элемента не рисует отрицательный прямоугольник", () => {
    const root = shadow();
    createOverlay(root, THEME).draw(targetWith({ left: 0, top: 0, width: 0, height: 0 }));

    const hole = boxOf(root, "hole");
    expect(hole.width).toBeGreaterThanOrEqual(0);
    expect(hole.height).toBeGreaterThanOrEqual(0);
  });

  it("переносится на новую цель", () => {
    const root = shadow();
    const overlay = createOverlay(root, THEME);

    overlay.draw(targetWith({ left: 0, top: 0, width: 10, height: 10 }));
    overlay.draw(targetWith({ left: 300, top: 200, width: 10, height: 10 }));

    expect(boxOf(root, "hole").left).toBe(296);
  });
});

describe("жизненный цикл", () => {
  it("не трогает целевой элемент", () => {
    const root = shadow();
    const target = targetWith({ left: 10, top: 20, width: 100, height: 40 });
    const before = target.outerHTML;

    createOverlay(root, THEME).draw(target);

    expect(target.outerHTML).toBe(before);
  });

  it("stop убирает рисунок из shadow root", () => {
    const root = shadow();
    const overlay = createOverlay(root, THEME);
    overlay.draw(targetWith({ left: 0, top: 0, width: 10, height: 10 }));

    overlay.stop();

    expect(root.querySelector("svg")).toBeNull();
  });
});
