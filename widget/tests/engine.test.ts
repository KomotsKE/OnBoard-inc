// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  bringIntoView,
  createEngine,
  type EngineDeps,
  type EngineTour,
  type FinishReason,
  resumeIndex,
} from "../src/core/engine";
import { createProgressStore } from "../src/core/progress";
import type { Resolution } from "../src/core/resolver";

function tourWith(count: number, showOnce = true): EngineTour {
  return {
    id: "t-1",
    show_once: showOnce,
    steps: Array.from({ length: count }, (_, index) => ({
      id: `s-${index}`,
      selector: `#шаг-${index}`,
      title: `Шаг ${index}`,
      body: "Текст",
      placement: "auto" as const,
    })),
  };
}

function setup(
  tour: EngineTour,
  resolve?: (selector: string) => Resolution,
  resolver?: { resolve: () => Promise<Resolution> },
) {
  const found = (selector: string): Resolution => ({
    status: "found",
    element: Object.assign(document.createElement("div"), { id: selector }),
  });
  const progress = createProgressStore("pk_тест", null);
  const finished: FinishReason[] = [];
  const tracked: { type: string; step_position?: number }[] = [];
  const deps: EngineDeps = {
    resolver: resolver
      ? { resolve: vi.fn(resolver.resolve), stop: vi.fn() }
      : {
          resolve: vi.fn(async (selector: string) => (resolve ?? found)(selector)),
          stop: vi.fn(),
        },
    overlay: { draw: vi.fn(), stop: vi.fn() },
    tooltip: { show: vi.fn(), reposition: vi.fn(), stop: vi.fn() },
    watcher: { watch: vi.fn(), stop: vi.fn() },
    progress,
    analytics: { track: (event) => void tracked.push(event) },
    view: window,
    onFinish: (reason) => finished.push(reason),
  };
  return { engine: createEngine(tour, deps), deps, progress, finished, tracked };
}

function shownIndexes(deps: EngineDeps): number[] {
  return (deps.tooltip.show as ReturnType<typeof vi.fn>).mock.calls.map(
    (call) => (call[2] as { index: number }).index,
  );
}

describe("проход по шагам", () => {
  it("начинает с первого шага и показывает его общее число", async () => {
    const { engine, deps } = setup(tourWith(4));

    await engine.start();

    expect(deps.tooltip.show).toHaveBeenCalledTimes(1);
    expect((deps.tooltip.show as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toEqual({
      index: 0,
      total: 4,
    });
  });

  it("«Далее» ведёт по шагам до конца", async () => {
    const { engine, deps, finished } = setup(tourWith(3));

    await engine.start();
    await engine.next();
    await engine.next();
    await engine.next();

    expect(shownIndexes(deps)).toEqual([0, 1, 2]);
    expect(finished).toEqual(["completed"]);
  });

  it("«Назад» возвращает на предыдущий шаг", async () => {
    const { engine, deps } = setup(tourWith(3));

    await engine.start();
    await engine.next();
    await engine.back();

    expect(shownIndexes(deps)).toEqual([0, 1, 0]);
  });

  it("«Назад» на первом шаге оставляет на первом", async () => {
    const { engine, deps } = setup(tourWith(3));

    await engine.start();
    await engine.back();

    expect(shownIndexes(deps)).toEqual([0, 0]);
  });

  it("подсветка, подсказка и наблюдатель получают один и тот же элемент", async () => {
    const { engine, deps } = setup(tourWith(1));

    await engine.start();

    const element = (deps.overlay.draw as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect((deps.tooltip.show as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe(element);
    expect((deps.watcher.watch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(element);
    expect(engine.current()).toBe(element);
  });
});

describe("окончание тура", () => {
  it("пройденный тур помечается в прогрессе", async () => {
    const { engine, progress, finished } = setup(tourWith(1));

    await engine.start();
    await engine.next();

    expect(finished).toEqual(["completed"]);
    expect(progress.read("t-1")).toEqual({ step: 0, done: true });
  });

  it("пропущенный тур тоже считается показанным", async () => {
    const { engine, progress, finished } = setup(tourWith(3));

    await engine.start();
    await engine.next();
    engine.skip();

    expect(finished).toEqual(["skipped"]);
    expect(progress.read("t-1")).toEqual({ step: 1, done: true });
  });

  it("ненайденная цель закрывает тур, но не помечает его пройденным", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { engine, progress, finished, deps } = setup(tourWith(2), () => ({
      status: "missing",
      reason: "not_found",
    }));

    await engine.start();

    // Поломка на стороне сайта, а не решение посетителя: когда вёрстку
    // починят, тур должен показаться снова (§3.3 docs/idea.md).
    expect(finished).toEqual(["target_missing"]);
    expect(progress.read("t-1")).toEqual({ step: 0, done: false });
    expect(deps.tooltip.show).not.toHaveBeenCalled();
    debug.mockRestore();
  });

  it("клик по «Далее», пока шаг ищется, не проскакивает шаг", async () => {
    let release: ((resolution: Resolution) => void) | undefined;
    const { engine, deps } = setup(tourWith(4), undefined, {
      resolve: () =>
        new Promise<Resolution>((settle) => {
          release = settle;
        }),
    });

    const first = engine.start();
    // Элемент первого шага ещё ищется — нетерпеливый посетитель жмёт «Далее».
    await engine.next();
    release?.({ status: "found", element: document.createElement("div") });
    await first;

    expect(shownIndexes(deps)).toEqual([0]);
  });

  it("после завершения кнопки больше ничего не делают", async () => {
    const { engine, deps, finished } = setup(tourWith(2));

    await engine.start();
    engine.skip();
    await engine.next();
    await engine.back();

    expect(shownIndexes(deps)).toEqual([0]);
    expect(finished).toEqual(["skipped"]);
  });

  it("остановка снаружи прогресс не трогает", async () => {
    const { engine, progress, finished } = setup(tourWith(3));
    await engine.start();
    await engine.next();

    engine.stop();

    expect(finished).toEqual([]);
    expect(progress.read("t-1")).toEqual({ step: 1, done: false });
  });
});

describe("показ цели за пределами экрана", () => {
  function elementAt(top: number, bottom: number): Element {
    const element = document.createElement("div");
    element.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
    element.scrollIntoView = vi.fn();
    return element;
  }

  it("прокручивает страницу к цели ниже сгиба", () => {
    const element = elementAt(900, 940);

    bringIntoView(element, { innerHeight: 800 } as Window);

    expect(element.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "instant" });
  });

  it("видимую цель не трогает", () => {
    // Дёргать чужую страницу без нужды нельзя.
    const element = elementAt(100, 140);

    bringIntoView(element, { innerHeight: 800 } as Window);

    expect(element.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("с какого шага показывать", () => {
  it("без прогресса — с первого", () => {
    expect(resumeIndex(tourWith(3), null)).toBe(0);
  });

  it("продолжает с сохранённого шага", () => {
    // Посетитель ушёл на другую страницу посреди тура (§3.3 docs/idea.md).
    expect(resumeIndex(tourWith(4), { step: 2, done: false })).toBe(2);
  });

  it("пройденный тур с show_once не показывается", () => {
    expect(resumeIndex(tourWith(3), { step: 2, done: true })).toBeNull();
  });

  it("без show_once пройденный тур начинается заново", () => {
    expect(resumeIndex(tourWith(3, false), { step: 2, done: true })).toBe(0);
  });

  it("сохранённый шаг старше тура приводится к границам", () => {
    // Шаги удалили в панели, пока посетитель был на полпути.
    expect(resumeIndex(tourWith(2), { step: 7, done: false })).toBe(1);
    expect(resumeIndex(tourWith(2), { step: -3, done: false })).toBe(0);
  });

  it("тур без шагов не показывается", () => {
    expect(resumeIndex(tourWith(0), null)).toBeNull();
  });
});

describe("события прохождения", () => {
  it("весь проход описывается событиями воронки", async () => {
    const { engine, tracked } = setup(tourWith(2));

    await engine.start();
    await engine.next();
    await engine.next();

    // По этим событиям в панели считается воронка (§7.2 docs/vision.md).
    expect(tracked.map((event) => event.type)).toEqual([
      "tour_started",
      "step_viewed",
      "step_viewed",
      "tour_completed",
    ]);
  });

  it("у всех событий одного прохода общий run_id", async () => {
    const { engine, tracked } = setup(tourWith(2));

    await engine.start();
    await engine.next();

    const runs = new Set(tracked.map((event) => (event as { run_id?: string }).run_id));
    expect(runs.size).toBe(1);
    expect([...runs][0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("шаг, на котором бросили тур, виден в событии", async () => {
    const { engine, tracked } = setup(tourWith(3));

    await engine.start();
    await engine.next();
    engine.skip();

    const skipped = tracked.find((event) => event.type === "tour_skipped");
    expect(skipped?.step_position).toBe(1);
  });

  it("«Назад» тоже событие: по нему видно, где непонятно", async () => {
    const { engine, tracked } = setup(tourWith(3));

    await engine.start();
    await engine.next();
    await engine.back();

    expect(tracked.filter((event) => event.type === "step_back")).toHaveLength(1);
  });

  it("ненайденная цель уходит событием, а не только в консоль", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { engine, tracked } = setup(tourWith(2), () => ({
      status: "missing",
      reason: "not_found",
    }));

    await engine.start();

    // Владельцу сайта это сообщение про его вёрстку: в панели оно попадёт
    // в блок «Проблемы» (T4.4).
    expect(tracked.map((event) => event.type)).toEqual(["tour_started", "step_target_missing"]);
    debug.mockRestore();
  });
});
