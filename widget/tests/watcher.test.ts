// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWatcher, type Watcher } from "../src/core/watcher";

const observers: ObserverStub[] = [];

/** jsdom не реализует ResizeObserver; подменяем возможность браузера. */
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

  fire(): void {
    this.callback();
  }
}

/** Пересчёт отложен до кадра; двух кадров достаточно, чтобы он прошёл. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

let watcher: Watcher | null = null;

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", ObserverStub);
});

afterEach(() => {
  watcher?.stop();
  watcher = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("слежение за геометрией", () => {
  it("сообщает о прокрутке", async () => {
    const onChange = vi.fn();
    watcher = createWatcher(document, onChange);

    window.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("сообщает об изменении размера окна", async () => {
    const onChange = vi.fn();
    watcher = createWatcher(document, onChange);

    window.dispatchEvent(new Event("resize"));
    await nextFrame();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("на пачку событий пересчитывает один раз", async () => {
    const onChange = vi.fn();
    watcher = createWatcher(document, onChange);

    for (let i = 0; i < 10; i += 1) {
      window.dispatchEvent(new Event("scroll"));
    }
    await nextFrame();

    // Прокрутка приходит пачками; пересчёт на каждое событие жёг бы кадры.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("следит за размером страницы и за размером цели", () => {
    const target = document.createElement("div");
    document.body.append(target);
    watcher = createWatcher(document, vi.fn());

    watcher.watch(target);

    // body — потому что вставка контента выше цели двигает её.
    expect(observers[0]!.observed).toEqual([document.body, target]);
  });

  it("при переходе к другой цели отпускает прежнюю", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    watcher = createWatcher(document, vi.fn());

    watcher.watch(first);
    watcher.watch(second);

    expect(observers[0]!.unobserved).toEqual([first]);
  });

  it("stop снимает слушатели и наблюдателя", async () => {
    const onChange = vi.fn();
    watcher = createWatcher(document, onChange);

    watcher.stop();
    window.dispatchEvent(new Event("scroll"));
    await nextFrame();

    // Утечка наблюдателей на SPA накапливается молча (§6 conventions.md).
    expect(onChange).not.toHaveBeenCalled();
    expect(observers[0]!.disconnected).toBe(true);
    watcher = null;
  });
});
