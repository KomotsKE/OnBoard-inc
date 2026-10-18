// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createResolver, findVisible, WAIT_TIMEOUT_MS } from "../src/core/resolver";

/**
 * jsdom не считает раскладку и не реализует `checkVisibility`, поэтому способность
 * браузера подменяется с той же семантикой: скрытым считается элемент, у которого
 * он сам или любой предок помечен `hidden`. Подменяется именно возможность
 * браузера, а не наш код: иначе тесты проверяли бы не ту ветку, которая работает
 * у посетителей.
 */
beforeEach(() => {
  Object.defineProperty(Element.prototype, "checkVisibility", {
    configurable: true,
    writable: true,
    value(this: Element) {
      return this.closest("[hidden]") === null;
    },
  });
});

afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).checkVisibility;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function markup(html: string): void {
  document.body.innerHTML = html;
}

describe("поиск видимого элемента", () => {
  it("находит элемент, который уже на странице", async () => {
    markup('<button data-testid="цель">Экспорт</button>');
    const resolver = createResolver(document);

    const resolution = await resolver.resolve('[data-testid="цель"]');

    expect(resolution).toEqual({
      status: "found",
      element: document.querySelector('[data-testid="цель"]'),
    });
  });

  it("пропускает скрытый дубль и берёт настоящий элемент", () => {
    // Адаптивная вёрстка: тот же селектор попадает и в мобильное меню, и в хедер.
    markup(`
      <nav hidden><button class="экспорт">Экспорт</button></nav>
      <header><button class="экспорт" id="настоящий">Экспорт</button></header>
    `);

    expect(findVisible(document, ".экспорт")?.id).toBe("настоящий");
  });
});

describe("ожидание появления", () => {
  it("дожидается элемента, вставленного позже", async () => {
    markup("<div id=\"слот\"></div>");
    const resolver = createResolver(document);

    const waiting = resolver.resolve("#отложенный");
    setTimeout(() => {
      const button = document.createElement("button");
      button.id = "отложенный";
      document.getElementById("слот")!.append(button);
    }, 20);

    const resolution = await waiting;

    expect(resolution.status).toBe("found");
  });

  it("дожидается, пока элемент перестанет быть скрытым", async () => {
    // Элемент уже в разметке: «появление» — это снятие атрибута, а не вставка.
    markup('<div hidden id="аккордеон"><button id="цель">Экспорт</button></div>');
    const resolver = createResolver(document);

    const waiting = resolver.resolve("#цель");
    setTimeout(() => document.getElementById("аккордеон")!.removeAttribute("hidden"), 20);

    expect((await waiting).status).toBe("found");
  });
});

describe("когда элемента нет", () => {
  it("по истечении таймаута сообщает, что ничего не найдено", async () => {
    vi.useFakeTimers();
    markup("<div></div>");
    const resolver = createResolver(document);

    const waiting = resolver.resolve("#нет-такого");
    await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT_MS);

    expect(await waiting).toEqual({ status: "missing", reason: "not_found" });
  });

  it("отличает скрытый элемент от отсутствующего", async () => {
    vi.useFakeTimers();
    // Владельцу сайта это две разные причины и два разных исправления.
    markup('<div hidden><button id="цель">Экспорт</button></div>');
    const resolver = createResolver(document);

    const waiting = resolver.resolve("#цель");
    await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT_MS);

    expect(await waiting).toEqual({ status: "missing", reason: "hidden" });
  });

  it("не ждёт десять секунд на неразбираемом селекторе", async () => {
    vi.useFakeTimers();
    const resolver = createResolver(document);

    // Промис должен быть готов сразу, без продвижения таймеров.
    const resolution = await resolver.resolve("#((");

    expect(resolution).toEqual({ status: "missing", reason: "invalid_selector" });
  });

  it("предел ожидания — десять секунд", () => {
    expect(WAIT_TIMEOUT_MS).toBe(10_000);
  });
});

describe("остановка ожидания", () => {
  it("снимает наблюдателя и завершает ожидание", async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const resolver = createResolver(document);

    const waiting = resolver.resolve("#нет-такого");
    resolver.stop();

    expect(await waiting).toEqual({ status: "missing", reason: "cancelled" });
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });

  it("новый шаг отменяет ожидание предыдущего", async () => {
    markup('<button id="второй">Готово</button>');
    const resolver = createResolver(document);

    const first = resolver.resolve("#первый");
    const second = await resolver.resolve("#второй");

    expect(await first).toEqual({ status: "missing", reason: "cancelled" });
    expect(second.status).toBe("found");
  });

  it("остановка после завершения ничего не ломает", async () => {
    markup('<button id="цель">Экспорт</button>');
    const resolver = createResolver(document);

    await resolver.resolve("#цель");

    expect(() => resolver.stop()).not.toThrow();
  });
});
