/**
 * Отправка событий прохождения тура.
 *
 * События копятся в буфере и уходят батчами: запрос на каждый шаг — это
 * десяток запросов с каждой страницы клиента. Не доехавший батч переживает
 * перезагрузку в localStorage и уходит при следующей загрузке, поэтому
 * воронка не теряет прогоны из-за одного обрыва сети.
 *
 * Ни IP, ни User-Agent, ни query-строку мы не отправляем: `device` считается
 * по возможностям браузера, адрес обрезается на сервере (инвариант №7).
 */

import { uuid } from "./id";

/** Флаш по таймеру: §7 docs/vision.md. */
const FLUSH_INTERVAL_MS = 5000;
/** …и по размеру, чтобы длинный тур не копил события до конца. */
const FLUSH_SIZE = 20;
/** Таймаут отправки батча — §9.1 docs/vision.md. */
const SEND_TIMEOUT_MS = 5000;
/** Экспоненциальная задержка повторов: 429 и сетевые отказы. */
const RETRY_DELAYS_MS = [1000, 2000, 4000];
/** Дольше суток событие не нужно никому. */
const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;

const PREFIX = "onboard.v1";

export type TrackedEvent = {
  type: string;
  tour_id?: string;
  step_id?: string;
  step_position?: number;
  run_id?: string;
  error_code?: string;
};

type StoredEvent = TrackedEvent & {
  event_id: string;
  visitor_id?: string;
  url: string;
  device: string;
};

export type Analytics = {
  track: (event: TrackedEvent) => void;
  /** `beacon` — отправка на выгрузке страницы, когда fetch уже не доживёт. */
  flush: (beacon?: boolean) => void;
  stop: () => void;
};

/**
 * Тип устройства — по возможностям браузера, а не по User-Agent.
 *
 * «Проверяй возможность, а не браузер»: разбор UA ломается на каждом новом
 * устройстве и заодно является отпечатком браузера (§7.1 docs/vision.md).
 */
export function deviceOf(view: Window): "desktop" | "mobile" | "tablet" {
  const coarse = view.matchMedia?.("(pointer: coarse)").matches ?? false;
  if (!coarse) {
    return "desktop";
  }
  return view.innerWidth >= 768 ? "tablet" : "mobile";
}

/** Анонимный идентификатор посетителя, свой на каждый проект (§6 vision.md). */
export function visitorId(view: Window, storage: Storage | null, publicKey: string): string {
  const key = `${PREFIX}.${publicKey}.visitor`;
  try {
    const saved = storage?.getItem(key);
    if (saved) {
      return saved;
    }
  } catch {
    // Хранилище недоступно — посетитель будет новым при каждой загрузке.
  }
  const fresh = uuid(view);
  try {
    storage?.setItem(key, fresh);
  } catch {
    // Та же деградация, что и с прогрессом: работаем без запоминания.
  }
  return fresh;
}

export function createAnalytics(deps: {
  view: Window;
  apiUrl: string;
  publicKey: string;
  storage: Storage | null;
}): Analytics {
  const { view, apiUrl, publicKey, storage } = deps;
  const endpoint = `${apiUrl}/v1/public/events`;
  const outboxKey = `${PREFIX}.${publicKey}.outbox`;
  const visitor = visitorId(view, storage, publicKey);

  let buffer: StoredEvent[] = [];
  let timer: number | null = null;
  let attempt = 0;
  let stopped = false;

  function enrich(event: TrackedEvent): StoredEvent {
    return {
      ...event,
      event_id: uuid(view),
      visitor_id: visitor,
      url: `${view.location.pathname}${view.location.search}`,
      device: deviceOf(view),
    };
  }

  function body(events: StoredEvent[]): string {
    return JSON.stringify({ key: publicKey, events });
  }

  function saveOutbox(events: StoredEvent[]): void {
    try {
      storage?.setItem(outboxKey, JSON.stringify({ at: Date.now(), events }));
    } catch {
      // Некуда отложить — событие теряется. Это аналитика, а не деньги.
    }
  }

  function takeOutbox(): StoredEvent[] {
    try {
      const raw = storage?.getItem(outboxKey);
      storage?.removeItem(outboxKey);
      if (!raw) {
        return [];
      }
      const saved = JSON.parse(raw) as { at: number; events: StoredEvent[] };
      // Протухшее не отправляем: сутки спустя оно уже никому не нужно.
      return Date.now() - saved.at < OUTBOX_TTL_MS ? saved.events : [];
    } catch {
      return [];
    }
  }

  function schedule(): void {
    if (timer !== null || stopped) {
      return;
    }
    timer = view.setTimeout(() => {
      timer = null;
      flush();
    }, FLUSH_INTERVAL_MS);
  }

  function retryLater(events: StoredEvent[]): void {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined || stopped) {
      // Повторы кончились: батч ждёт следующей загрузки страницы.
      saveOutbox(events);
      attempt = 0;
      return;
    }
    attempt += 1;
    view.setTimeout(() => send(events), delay);
  }

  async function send(events: StoredEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const abort = new AbortController();
    const timeout = view.setTimeout(() => abort.abort(), SEND_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        // text/plain — тот же простой запрос, что и у sendBeacon: без
        // preflight, одинаково и здесь, и на выгрузке страницы.
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: body(events),
        credentials: "omit",
        mode: "cors",
        keepalive: true,
      });
      if (response.status === 429 || response.status >= 500) {
        // Отказ, который чинится повтором.
        retryLater(events);
        return;
      }
      // 2xx и 4xx одинаково означают «повторять незачем»: битое событие
      // не станет валидным, а чужой домен не станет своим.
      attempt = 0;
    } catch (error) {
      // Намеренно мимо `report`: тот отправляет `widget_error` событием, то
      // есть отказ доставки порождал бы новое событие, новую отправку и новый
      // отказ. На сломанной сети это шторм, а не диагностика.
      console.debug("[OnBoard] события не доставлены", error);
      retryLater(events);
    } finally {
      view.clearTimeout(timeout);
    }
  }

  function flush(beacon = false): void {
    const events = buffer;
    buffer = [];
    if (events.length === 0) {
      return;
    }
    if (beacon) {
      // На выгрузке страницы fetch уже не доживёт до ответа; sendBeacon
      // отдаёт батч браузеру, и тот доставляет его сам.
      const sent = view.navigator.sendBeacon?.(endpoint, body(events));
      if (!sent) {
        saveOutbox(events);
      }
      return;
    }
    void send(events);
  }

  function onVisibilityChange(): void {
    if (view.document.visibilityState === "hidden") {
      flush(true);
    }
  }

  view.document.addEventListener("visibilitychange", onVisibilityChange);

  // Батч, не доехавший в прошлый раз, уходит первым.
  const pending = takeOutbox();
  if (pending.length > 0) {
    void send(pending);
  }

  return {
    track(event: TrackedEvent): void {
      if (stopped) {
        return;
      }
      buffer.push(enrich(event));
      if (buffer.length >= FLUSH_SIZE) {
        flush();
        return;
      }
      schedule();
    },

    flush,

    stop(): void {
      stopped = true;
      view.document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== null) {
        view.clearTimeout(timer);
        timer = null;
      }
      flush();
    },
  };
}
