// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  alreadyInitialised,
  configUrl,
  createApplier,
  fetchConfig,
  pageUrl,
  readConfig,
  start,
  watchUrl,
  type WidgetConfig,
} from "../src/loader/index";

const CORE_URL = "http://cdn.test/widget/core.abc1234567.js";

function scriptWith(attrs: Record<string, string>): HTMLScriptElement {
  const script = document.createElement("script");
  for (const [name, value] of Object.entries(attrs)) {
    script.setAttribute(name, value);
  }
  return script;
}

/** Окно сайта клиента: настоящий document нужен только как фабрика тегов. */
function fakeWindow(
  attrs: Record<string, string> = { "data-key": "pk_abc", "data-api": "https://api.test" },
  location: { pathname: string; search: string } = { pathname: "/reports", search: "" },
): Window {
  return {
    document: {
      currentScript: scriptWith(attrs),
      head: document.head,
      createElement: (tag: string) => document.createElement(tag),
    },
    location,
  } as unknown as Window;
}

function configWith(tour: WidgetConfig["tour"]): WidgetConfig {
  return { core_url: CORE_URL, project: { theme: {} }, tour };
}

const TOUR: WidgetConfig["tour"] = {
  id: "t-1",
  name: "Знакомство",
  show_once: true,
  steps: [
    { id: "s-1", position: 0, selector: "#цель", title: "Шаг", body: "Текст", placement: "auto" },
  ],
};

function respondWith(config: WidgetConfig) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => config }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Даёт догореть `boot`: он запущен без await — страница клиента не ждёт нас. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadedCores(): string[] {
  return Array.from(document.head.querySelectorAll("script[src]"), (node) =>
    node.getAttribute("src"),
  ).filter((src): src is string => src !== null);
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelectorAll("script[src]").forEach((node) => node.remove());
});

describe("чтение параметров тега", () => {
  it("берёт ключ и адрес API", () => {
    const config = readConfig(
      scriptWith({ "data-key": "pk_abc", "data-api": "https://api.example/" }),
    );

    // Завершающий слэш срезается: иначе получим https://api.example//v1/...
    expect(config).toEqual({ publicKey: "pk_abc", apiUrl: "https://api.example" });
  });

  it("не запускается без обязательных параметров", () => {
    expect(readConfig(scriptWith({ "data-key": "pk_abc" }))).toBeNull();
    expect(readConfig(scriptWith({ "data-api": "https://api.example" }))).toBeNull();
    expect(readConfig(null)).toBeNull();
  });

  it("игнорирует пробелы вокруг значений", () => {
    const config = readConfig(
      scriptWith({ "data-key": "  pk_abc  ", "data-api": "  https://api.example  " }),
    );

    expect(config?.publicKey).toBe("pk_abc");
  });
});

describe("адрес запроса конфига", () => {
  it("отправляет pathname и search, но не hash", () => {
    // hash в SPA меняется произвольно и в сравнении не участвует.
    expect(pageUrl({ pathname: "/reports", search: "?plan=pro" })).toBe("/reports?plan=pro");
    expect(pageUrl({ pathname: "/", search: "" })).toBe("/");
  });

  it("кодирует параметры", () => {
    const url = configUrl({ publicKey: "pk_abc", apiUrl: "https://api.test" }, "/reports?plan=pro");

    expect(url).toBe("https://api.test/v1/public/config?key=pk_abc&url=%2Freports%3Fplan%3Dpro");
  });
});

describe("запрос конфига", () => {
  it("возвращает разобранный ответ", async () => {
    respondWith(configWith(TOUR));

    const config = await fetchConfig("https://api.test/v1/public/config");

    expect(config?.tour?.id).toBe("t-1");
  });

  it("на отказ отвечает null, а не исключением", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));

    expect(await fetchConfig("https://api.test/v1/public/config")).toBeNull();

    debug.mockRestore();
  });

  it("не ждёт дольше таймаута", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    // Запрос, который не ответит никогда: прерывает его только AbortController.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("AbortError")));
          }),
      ),
    );

    expect(await fetchConfig("https://api.test/v1/public/config", 5)).toBeNull();

    debug.mockRestore();
  });
});

describe("ленивая загрузка ядра", () => {
  it("грузит ядро один раз, когда для страницы есть тур", async () => {
    const fetchMock = respondWith(configWith(TOUR));
    const target = fakeWindow();

    start(target);
    await settled();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loadedCores()).toEqual([CORE_URL]);
  });

  it("не грузит ядро на странице без тура", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    respondWith(configWith(null));

    start(fakeWindow());
    await settled();

    // Ровно та экономия, ради которой загрузка разделена на два этапа.
    expect(loadedCores()).toEqual([]);
    debug.mockRestore();
  });

  it("не грузит ядро, когда конфиг недоступен", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("сеть недоступна"))));

    start(fakeWindow());
    await settled();

    expect(loadedCores()).toEqual([]);
    debug.mockRestore();
  });

  it("кладёт конфиг в глобал — ядро не запрашивает его повторно", async () => {
    respondWith(configWith(TOUR));
    const target = fakeWindow();

    start(target);
    await settled();

    const api = (target as unknown as Record<string, { boot?: WidgetConfig } | undefined>).OnBoard;
    expect(api?.boot?.tour?.id).toBe("t-1");
  });
});

describe("защита от повторной вставки", () => {
  it("видит уже инициализированный виджет", () => {
    const target = { OnBoard: { version: "0.1.0" } } as unknown as Window;

    expect(alreadyInitialised(target)).toBe(true);
  });

  it("второй сниппет не делает ни запроса, ни оверлея", async () => {
    const fetchMock = respondWith(configWith(TOUR));
    const target = fakeWindow();

    start(target);
    start(target);
    await settled();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loadedCores()).toEqual([CORE_URL]);
  });

  it("второй запуск не перезаписывает глобал", () => {
    const first = { version: "первый" };
    const target = { OnBoard: first, document: { currentScript: null } } as unknown as Window;

    start(target);

    expect((target as unknown as Record<string, unknown>).OnBoard).toBe(first);
  });

  it("не выбрасывает исключение, если окружение неожиданное", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    // Сайт клиента не должен падать из-за нас ни при каких входных данных.
    expect(() => start({} as unknown as Window)).not.toThrow();

    debug.mockRestore();
  });
});

describe("навигация в SPA", () => {
  type Api = {
    version: string;
    config: { publicKey: string; apiUrl: string };
    boot?: WidgetConfig;
    start?: () => void;
    stop?: () => void;
  };

  /** Окно с историей и адресом, которые можно менять как в SPA. */
  function spaWindow(path = "/reports") {
    const location = { pathname: path, search: "" };
    const listeners = new Map<string, EventListener[]>();
    const site = { pushed: 0 };
    const history = {
      // Счётчик сайта: его обёртка должна продолжать работать поверх нашей.
      pushState(..._args: unknown[]) {
        site.pushed += 1;
        return "результат сайта";
      },
      replaceState(..._args: unknown[]) {
        return undefined;
      },
    };

    const target = {
      document: {
        currentScript: null,
        head: document.head,
        createElement: (tag: string) => document.createElement(tag),
      },
      location,
      history,
      site,
      setTimeout: (fn: () => void) => setTimeout(fn, 0),
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener));
      },
      fire: (type: string) => listeners.get(type)?.forEach((listener) => listener(new Event(type))),
      goTo: (next: string) => {
        location.pathname = next;
        history.pushState({}, "", next);
      },
    };
    return target as unknown as Window & typeof target;
  }

  function apiFor(): Api {
    return { version: "0.1.0", config: { publicKey: "pk_abc", apiUrl: "https://api.test" } };
  }

  it("оригинальный pushState продолжает работать", () => {
    const target = spaWindow();
    const unwatch = watchUrl(target, vi.fn());

    const result = target.history.pushState({}, "", "/dashboard");

    // Счётчик сайта вырос, а результат вернулся его собственный.
    expect(target.site.pushed).toBe(1);
    expect(result).toBe("результат сайта");
    unwatch();
  });

  it("возвращает методы истории на место", () => {
    const target = spaWindow();
    const original = target.history.pushState;

    watchUrl(target, vi.fn())();

    expect(target.history.pushState).toBe(original);
  });

  it("схлопывает pushState и следующий за ним replaceState в один вызов", async () => {
    const target = spaWindow();
    const onChange = vi.fn();
    watchUrl(target, onChange);

    target.history.pushState({}, "", "/dashboard");
    target.history.replaceState({}, "", "/dashboard?x=1");
    await settled();

    // SPA часто делает оба подряд; реагировать стоит на итоговый адрес.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("замечает возврат по кнопке «назад»", async () => {
    const target = spaWindow();
    const onChange = vi.fn();
    watchUrl(target, onChange);

    target.fire("popstate");
    await settled();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("на новом адресе запрашивает конфиг заново", async () => {
    const target = spaWindow("/settings");
    const fetchMock = respondWith(configWith(null));
    const apply = createApplier(target, apiFor());

    await apply();
    target.goTo("/reports");
    await apply();

    const urls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(urls.map((url) => new URL(url).searchParams.get("url"))).toEqual([
      "/settings",
      "/reports",
    ]);
  });

  it("тот же адрес второго запроса не делает", async () => {
    const target = spaWindow();
    const fetchMock = respondWith(configWith(TOUR));
    const apply = createApplier(target, apiFor());

    await apply();
    await apply();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("на странице с туром грузит ядро один раз, дальше перезапускает его", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const target = spaWindow();
    respondWith(configWith(TOUR));
    const api = apiFor();
    const apply = createApplier(target, api);

    await apply();
    // Ядро загрузилось и объявило свою часть поверхности.
    api.start = vi.fn();
    api.stop = vi.fn();
    target.goTo("/reports/weekly");
    await apply();

    expect(loadedCores()).toEqual([CORE_URL]);
    expect(api.start).toHaveBeenCalledTimes(1);
    debug.mockRestore();
  });

  it("на странице без тура закрывает идущий тур", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const target = spaWindow();
    const api = apiFor();
    api.stop = vi.fn();
    respondWith(configWith(null));
    const apply = createApplier(target, api);

    await apply();

    // Тур привязан к адресу: на посторонней странице ему делать нечего.
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(loadedCores()).toEqual([]);
    debug.mockRestore();
  });
});
