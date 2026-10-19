// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { guard, report } from "../src/core/guard";
import { createTooltip } from "../src/core/tooltip";
import { createWatcher } from "../src/core/watcher";

let debug: ReturnType<typeof vi.spyOn>;

function silence(): void {
  debug = vi.spyOn(console, "debug").mockImplementation(() => {});
}

afterEach(() => {
  debug?.mockRestore();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("обёртка точки входа", () => {
  it("передаёт аргументы и вызывает функцию", () => {
    const fn = vi.fn();

    guard("unexpected", fn)("первый", 2);

    expect(fn).toHaveBeenCalledWith("первый", 2);
  });

  it("гасит исключение и сообщает код", () => {
    silence();
    const broken = guard("render_failed", () => {
      throw new Error("внутренняя поломка");
    });

    // Сайт клиента не должен падать из-за нас ни при каких входных данных.
    expect(() => broken()).not.toThrow();
    expect(debug).toHaveBeenCalledWith("[OnBoard] render_failed", expect.any(Error));
  });

  it("пишет только в console.debug", () => {
    silence();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    report("unexpected", "что-то пошло не так");

    // Чужая консоль — не наше место для диагностики (§6 conventions.md).
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    error.mockRestore();
    log.mockRestore();
  });
});

describe("контур на живых точках входа", () => {
  it("упавший обработчик кнопки не вырывается на страницу", () => {
    silence();
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const tooltip = createTooltip(
      root,
      { next: "Далее", skip: "Пропустить", done: "Готово" },
      {
        onNext: () => {
          throw new Error("движок сломался");
        },
        onBack: vi.fn(),
        onSkip: vi.fn(),
      },
    );
    const target = document.createElement("button");
    document.body.append(target);
    tooltip.show({ title: "", body: "Текст", placement: "auto" }, target, { index: 0, total: 1 });

    const click = (): void => root.querySelector<HTMLElement>('[data-part="next"]')?.click();

    expect(click).not.toThrow();
    expect(debug).toHaveBeenCalledWith("[OnBoard] unexpected", expect.any(Error));
  });

  it("упавший пересчёт геометрии не мешает следующему", async () => {
    silence();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    let calls = 0;
    const watcher = createWatcher(document, () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("элемент исчез");
      }
    });

    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // Один упавший кадр не должен выключать слежение до конца тура.
    expect(calls).toBe(2);
    expect(debug).toHaveBeenCalledWith("[OnBoard] render_failed", expect.any(Error));
    watcher.stop();
  });
});
