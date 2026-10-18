// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start, stop } from "../src/core/index";
import { WAIT_TIMEOUT_MS } from "../src/core/resolver";

const THEME = {
  primary_color: "#2563EB",
  text_color: "#0F172A",
  backdrop_opacity: 0.55,
  border_radius: "8px",
};

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function bootWith(selector: string | null): void {
  const tour =
    selector === null
      ? null
      : {
          id: "t-1",
          name: "Знакомство",
          show_once: true,
          steps: [
            { id: "s-1", position: 0, selector, title: "Шаг", body: "Текст", placement: "auto" },
          ],
        };
  (window as unknown as Record<string, unknown>).OnBoard = {
    version: "0.1.0",
    boot: { core_url: "http://cdn.test/core.js", project: { theme: THEME }, tour },
  };
}

function overlayHost(): Element | null {
  return document.querySelector('[data-onboard="overlay"]');
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObserverStub);
  Object.defineProperty(Element.prototype, "checkVisibility", {
    configurable: true,
    writable: true,
    value: () => true,
  });
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (Element.prototype as unknown as Record<string, unknown>).checkVisibility;
  delete (window as unknown as Record<string, unknown>).OnBoard;
  document.body.innerHTML = "";
});

describe("запуск ядра", () => {
  it("подсвечивает цель первого шага", async () => {
    document.body.innerHTML = '<button id="цель">Экспорт</button>';
    bootWith("#цель");

    await start(window);

    expect(overlayHost()).not.toBeNull();
  });

  it("без тура не создаёт оверлей", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    bootWith(null);

    await start(window);

    expect(overlayHost()).toBeNull();
    debug.mockRestore();
  });

  it("не оставляет затемнение без выреза, если цель не нашлась", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.useFakeTimers();
    bootWith("#нет-такого");

    const starting = start(window);
    await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT_MS);
    await starting;

    // Затемнённая страница без подсвеченного элемента хуже, чем отсутствие тура.
    expect(overlayHost()).toBeNull();
    debug.mockRestore();
  });

  it("повторный запуск не плодит оверлеи", async () => {
    document.body.innerHTML = '<button id="цель">Экспорт</button>';
    bootWith("#цель");

    await start(window);
    await start(window);

    expect(document.querySelectorAll('[data-onboard="overlay"]')).toHaveLength(1);
  });

  it("stop возвращает страницу в исходное состояние", async () => {
    document.body.innerHTML = '<button id="цель">Экспорт</button>';
    const before = document.body.innerHTML;
    bootWith("#цель");

    await start(window);
    stop();

    expect(document.body.innerHTML).toBe(before);
  });
});
