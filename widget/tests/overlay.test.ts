// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOverlay, type Overlay, type OverlayTheme } from "../src/core/overlay";

const THEME: OverlayTheme = {
  primaryColor: "#2563EB",
  backdropOpacity: 0.55,
  borderRadius: "8px",
};

/** jsdom не реализует ResizeObserver; подменяем возможность браузера. */
const observers: ObserverStub[] = [];

class ObserverStub {
  readonly observed: Element[] = [];
  readonly unobserved: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: () => void) {
    observers.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(element: Element): void {
    this.unobserved.push(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** Имитирует срабатывание наблюдателя: размер цели или страницы изменился. */
  fire(): void {
    this.callback();
  }
}

let overlay: Overlay | null = null;

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", ObserverStub);
});

afterEach(() => {
  overlay?.stop();
  overlay = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

type Box = { left: number; top: number; width: number; height: number };

/** jsdom не считает раскладку, поэтому прямоугольник цели задаётся явно. */
function targetWith(box: Box): HTMLElement {
  const element = document.createElement("button");
  element.id = "цель";
  document.body.append(element);
  rectOf(element, box);
  return element;
}

function rectOf(element: Element, box: Box): void {
  element.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => box,
    }) as DOMRect;
}

function host(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-onboard="overlay"]');
  if (!node) {
    throw new Error("хост оверлея не найден");
  }
  return node;
}

function part(name: string): Element {
  const node = host().shadowRoot?.querySelector(`[data-part="${name}"]`);
  if (!node) {
    throw new Error(`в shadow root нет части ${name}`);
  }
  return node;
}

function boxOf(name: string): Box & { rx: number } {
  const node = part(name);
  return {
    left: Number(node.getAttribute("x")),
    top: Number(node.getAttribute("y")),
    width: Number(node.getAttribute("width")),
    height: Number(node.getAttribute("height")),
    rx: Number(node.getAttribute("rx")),
  };
}

/** Пересчёт отложен до кадра; двух кадров достаточно, чтобы он прошёл. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

describe("изоляция от страницы клиента", () => {
  it("живёт в shadow root под одним хостом в body", () => {
    overlay = createOverlay(document, THEME);

    expect(host().parentElement).toBe(document.body);
    expect(host().shadowRoot).not.toBeNull();
  });

  it("не добавляет в документ клиента ни одного стиля", () => {
    overlay = createOverlay(document, THEME);
    overlay.highlight(targetWith({ left: 10, top: 20, width: 100, height: 40 }));

    // Следствие ADR-0002, проверяемое буквально.
    expect(document.head.querySelectorAll("style, link")).toHaveLength(0);
    expect(document.body.querySelectorAll("style")).toHaveLength(0);
  });

  it("не перехватывает события и стоит поверх чужих виджетов", () => {
    overlay = createOverlay(document, THEME);

    const style = host().style;
    expect(style.pointerEvents).toBe("none");
    expect(style.position).toBe("fixed");
    // Столько же держат чужие виджеты — ADR-0002.
    expect(style.zIndex).toBe("2147483000");
  });

  it("не меняет целевой элемент", () => {
    overlay = createOverlay(document, THEME);
    const target = targetWith({ left: 10, top: 20, width: 100, height: 40 });
    const before = target.outerHTML;

    overlay.highlight(target);

    expect(target.outerHTML).toBe(before);
  });
});

describe("геометрия выреза", () => {
  it("вырезает окно вокруг цели с зазором", () => {
    overlay = createOverlay(document, THEME);

    overlay.highlight(targetWith({ left: 100, top: 50, width: 200, height: 40 }));

    // Зазор 4 px с каждой стороны: рамка не должна ложиться на границу элемента.
    expect(boxOf("hole")).toEqual({ left: 96, top: 46, width: 208, height: 48, rx: 8 });
  });

  it("белая обводка ложится вплотную к брендовой, без щели", () => {
    overlay = createOverlay(document, THEME);

    overlay.highlight(targetWith({ left: 100, top: 50, width: 200, height: 40 }));

    const inner = boxOf("ring-inner");
    const outer = boxOf("ring-outer");
    // Обводка рисуется по центру контура: брендовая (2) занимает ±1 от своего
    // контура, белая (3) — ±1.5 от своего. Сдвиг на 2.5 ставит их вплотную.
    expect(outer.left).toBe(inner.left - 2.5);
    expect(outer.width).toBe(inner.width + 5);
    expect(part("ring-inner").getAttribute("stroke")).toBe("#2563EB");
    expect(part("ring-outer").getAttribute("stroke")).toBe("#fff");
  });

  it("берёт затемнение и скругление из темы", () => {
    overlay = createOverlay(document, {
      primaryColor: "#112233",
      backdropOpacity: 0.3,
      borderRadius: "12px",
    });

    overlay.highlight(targetWith({ left: 0, top: 0, width: 10, height: 10 }));

    expect(part("backdrop").getAttribute("opacity")).toBe("0.3");
    expect(boxOf("hole").rx).toBe(12);
  });

  it("на непонятном скруглении берёт значение по умолчанию", () => {
    // Тема допускает любую строку до 16 символов, геометрии SVG нужны пиксели.
    overlay = createOverlay(document, { ...THEME, borderRadius: "0.5rem" });

    overlay.highlight(targetWith({ left: 0, top: 0, width: 10, height: 10 }));

    expect(boxOf("hole").rx).toBe(8);
  });

  it("у схлопнутого элемента не рисует отрицательный прямоугольник", () => {
    overlay = createOverlay(document, THEME);

    overlay.highlight(targetWith({ left: 0, top: 0, width: 0, height: 0 }));

    const hole = boxOf("hole");
    expect(hole.width).toBeGreaterThanOrEqual(0);
    expect(hole.height).toBeGreaterThanOrEqual(0);
  });
});

describe("слежение за геометрией", () => {
  it("переносит окно при прокрутке", async () => {
    overlay = createOverlay(document, THEME);
    const target = targetWith({ left: 100, top: 300, width: 200, height: 40 });
    overlay.highlight(target);

    rectOf(target, { left: 100, top: 120, width: 200, height: 40 });
    window.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(boxOf("hole").top).toBe(116);
  });

  it("переносит окно, когда цель изменила размер", async () => {
    overlay = createOverlay(document, THEME);
    const target = targetWith({ left: 10, top: 10, width: 100, height: 20 });
    overlay.highlight(target);

    rectOf(target, { left: 10, top: 10, width: 300, height: 20 });
    observers[0]!.fire();
    await nextFrame();

    expect(boxOf("hole").width).toBe(308);
  });

  it("на пачку событий пересчитывает один раз", async () => {
    overlay = createOverlay(document, THEME);
    const target = targetWith({ left: 0, top: 0, width: 10, height: 10 });
    overlay.highlight(target);
    const measure = vi.spyOn(target, "getBoundingClientRect");

    for (let i = 0; i < 10; i += 1) {
      window.dispatchEvent(new Event("scroll"));
    }
    await nextFrame();

    // Прокрутка приходит пачками; пересчёт на каждое событие жёг бы кадры.
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("следит и за размером страницы: вставка контента выше двигает цель", () => {
    overlay = createOverlay(document, THEME);

    expect(observers[0]!.observed).toContain(document.body);
  });

  it("при переходе к другой цели отпускает прежнюю", () => {
    overlay = createOverlay(document, THEME);
    const first = targetWith({ left: 0, top: 0, width: 10, height: 10 });
    const second = targetWith({ left: 50, top: 50, width: 10, height: 10 });

    overlay.highlight(first);
    overlay.highlight(second);

    expect(observers[0]!.unobserved).toContain(first);
    expect(boxOf("hole").left).toBe(46);
  });
});

describe("остановка", () => {
  it("убирает хост и перестаёт слушать", async () => {
    overlay = createOverlay(document, THEME);
    const target = targetWith({ left: 0, top: 0, width: 10, height: 10 });
    overlay.highlight(target);

    overlay.stop();
    const measure = vi.spyOn(target, "getBoundingClientRect");
    window.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(document.querySelector('[data-onboard="overlay"]')).toBeNull();
    expect(observers[0]!.disconnected).toBe(true);
    expect(measure).not.toHaveBeenCalled();
    overlay = null;
  });
});
