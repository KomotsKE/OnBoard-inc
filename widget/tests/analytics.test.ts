// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAnalytics, deviceOf, visitorId, type Analytics } from "../src/core/analytics";
import { uuid } from "../src/core/id";

const KEY = "pk_00000000000000000000000000000001";
const API = "https://api.test";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

type FakeView = Window & { fire: (type: string) => void; beacon: ReturnType<typeof vi.fn> };

/** Окно страницы клиента: ровно те возможности, которыми пользуется модуль. */
function fakeView(options: { coarse?: boolean; width?: number; beaconOk?: boolean } = {}): FakeView {
  const listeners = new Map<string, EventListener[]>();
  const beacon = vi.fn(() => options.beaconOk ?? true);
  const view = {
    crypto: globalThis.crypto,
    innerWidth: options.width ?? 1280,
    matchMedia: (query: string) => ({ matches: query.includes("coarse") && !!options.coarse }),
    location: { pathname: "/reports", search: "?page=2" },
    navigator: { sendBeacon: beacon },
    setTimeout: ((fn: () => void, ms: number) => setTimeout(fn, ms)) as Window["setTimeout"],
    clearTimeout: ((id: number) => clearTimeout(id)) as Window["clearTimeout"],
    document: {
      visibilityState: "visible",
      addEventListener: (type: string, listener: EventListener) =>
        listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      removeEventListener: (type: string, listener: EventListener) =>
        listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener)),
    },
    fire: (type: string) => listeners.get(type)?.forEach((listener) => listener(new Event(type))),
    beacon,
  };
  return view as unknown as FakeView;
}

function okFetch(status = 204) {
  const mock = vi.fn(async () => ({ status }) as Response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function sentEvents(mock: ReturnType<typeof okFetch>): { type: string }[] {
  return mock.mock.calls.flatMap((call) => {
    const init = (call as unknown[])[1] as RequestInit;
    return (JSON.parse(String(init.body)) as { events: { type: string }[] }).events;
  });
}

let analytics: Analytics | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  analytics?.stop();
  analytics = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("тип устройства", () => {
  it("определяется возможностями браузера, а не User-Agent", () => {
    // Разбор UA ломается на каждом новом устройстве и служит отпечатком.
    expect(deviceOf(fakeView({ coarse: false }))).toBe("desktop");
    expect(deviceOf(fakeView({ coarse: true, width: 375 }))).toBe("mobile");
    expect(deviceOf(fakeView({ coarse: true, width: 820 }))).toBe("tablet");
  });
});

describe("идентификаторы", () => {
  it("посетитель запоминается и переиспользуется", () => {
    const storage = memoryStorage();
    const view = fakeView();

    const first = visitorId(view, storage, KEY);

    expect(visitorId(view, storage, KEY)).toBe(first);
    // Ключ включает публичный ключ проекта: клиенты на поддоменах одного
    // домена не должны делить посетителя (§6 docs/vision.md).
    expect(visitorId(view, storage, "pk_другой")).not.toBe(first);
  });

  it("без хранилища посетитель просто новый", () => {
    const view = fakeView();

    expect(visitorId(view, null, KEY)).not.toBe(visitorId(view, null, KEY));
  });

  it("uuid остаётся валидным без crypto.randomUUID", () => {
    // На http `randomUUID` недоступен, а виджет работать обязан.
    const view = {
      crypto: { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) },
    } as unknown as Window;

    expect(uuid(view)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("буфер и отправка", () => {
  it("копит события и отправляет батчем по таймеру", async () => {
    const fetchMock = okFetch();
    const view = fakeView();
    analytics = createAnalytics({ view, apiUrl: API, publicKey: KEY, storage: memoryStorage() });

    analytics.track({ type: "tour_started" });
    analytics.track({ type: "step_viewed" });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    // Один запрос на оба события: запрос на каждый шаг — это десяток
    // запросов с каждой страницы клиента.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEvents(fetchMock).map((event) => event.type)).toEqual([
      "tour_started",
      "step_viewed",
    ]);
  });

  it("не ждёт таймера, когда батч набрался", async () => {
    const fetchMock = okFetch();
    analytics = createAnalytics({
      view: fakeView(),
      apiUrl: API,
      publicKey: KEY,
      storage: memoryStorage(),
    });

    for (let i = 0; i < 20; i += 1) {
      analytics.track({ type: "step_viewed" });
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEvents(fetchMock)).toHaveLength(20);
  });

  it("добавляет к событию адрес, устройство и посетителя", async () => {
    const fetchMock = okFetch();
    analytics = createAnalytics({
      view: fakeView(),
      apiUrl: API,
      publicKey: KEY,
      storage: memoryStorage(),
    });

    analytics.track({ type: "tour_started" });
    await vi.advanceTimersByTimeAsync(5000);

    const [event] = sentEvents(fetchMock) as unknown as Record<string, string>[];
    expect(event).toMatchObject({ url: "/reports?page=2", device: "desktop" });
    expect(event!.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event!.visitor_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("отказы доставки", () => {
  it("на 429 повторяет с нарастающей задержкой", async () => {
    const fetchMock = vi.fn(async () => ({ status: 429 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    analytics = createAnalytics({
      view: fakeView(),
      apiUrl: API,
      publicKey: KEY,
      storage: memoryStorage(),
    });

    analytics.track({ type: "tour_started" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("исчерпав повторы, откладывает батч до следующей загрузки", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 503 }) as Response));
    const storage = memoryStorage();
    analytics = createAnalytics({ view: fakeView(), apiUrl: API, publicKey: KEY, storage });

    analytics.track({ type: "tour_started" });
    await vi.advanceTimersByTimeAsync(5000 + 1000 + 2000 + 4000);

    const saved = storage.getItem(`onboard.v1.${KEY}.outbox`);
    expect(saved).toContain("tour_started");
  });

  it("отложенный батч уходит при следующей загрузке", async () => {
    const storage = memoryStorage();
    storage.setItem(
      `onboard.v1.${KEY}.outbox`,
      JSON.stringify({ at: Date.now(), events: [{ type: "tour_completed", event_id: "e1" }] }),
    );
    const fetchMock = okFetch();

    analytics = createAnalytics({ view: fakeView(), apiUrl: API, publicKey: KEY, storage });
    await vi.advanceTimersByTimeAsync(0);

    expect(sentEvents(fetchMock).map((event) => event.type)).toEqual(["tour_completed"]);
    // Отправленное не уходит во второй раз.
    expect(storage.getItem(`onboard.v1.${KEY}.outbox`)).toBeNull();
  });

  it("протухший батч не отправляется", async () => {
    const storage = memoryStorage();
    storage.setItem(
      `onboard.v1.${KEY}.outbox`,
      JSON.stringify({
        at: Date.now() - 25 * 60 * 60 * 1000,
        events: [{ type: "tour_started", event_id: "e1" }],
      }),
    );
    const fetchMock = okFetch();

    analytics = createAnalytics({ view: fakeView(), apiUrl: API, publicKey: KEY, storage });
    await vi.advanceTimersByTimeAsync(0);

    // Сутки спустя событие не нужно никому.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("на 4xx не повторяет: повтор это не починит", async () => {
    const fetchMock = vi.fn(async () => ({ status: 403 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    analytics = createAnalytics({
      view: fakeView(),
      apiUrl: API,
      publicKey: KEY,
      storage: memoryStorage(),
    });

    analytics.track({ type: "tour_started" });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("выгрузка страницы", () => {
  it("на скрытии вкладки отдаёт батч через sendBeacon", async () => {
    const fetchMock = okFetch();
    const view = fakeView();
    analytics = createAnalytics({ view, apiUrl: API, publicKey: KEY, storage: memoryStorage() });
    analytics.track({ type: "step_viewed" });

    (view.document as unknown as { visibilityState: string }).visibilityState = "hidden";
    view.fire("visibilitychange");

    // fetch до ответа не доживёт, а sendBeacon браузер доставит сам.
    expect(view.beacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("если браузер не принял beacon, батч остаётся на следующий раз", () => {
    const storage = memoryStorage();
    const view = fakeView({ beaconOk: false });
    analytics = createAnalytics({ view, apiUrl: API, publicKey: KEY, storage });
    analytics.track({ type: "step_viewed" });

    (view.document as unknown as { visibilityState: string }).visibilityState = "hidden";
    view.fire("visibilitychange");

    expect(storage.getItem(`onboard.v1.${KEY}.outbox`)).toContain("step_viewed");
  });
});
