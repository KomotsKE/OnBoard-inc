/**
 * Загрузчик: всё, что исполняется на чужой странице сразу.
 *
 * Делает ровно три вещи: читает параметры тега, запрашивает конфиг и — только
 * если для этой страницы есть тур — подгружает ядро. Логики тура здесь нет
 * и не будет: загрузчик обновляется у клиентов медленнее ядра, потому что
 * кэшируется на пять минут, а ядро — по хэшу навсегда (ADR-0009).
 *
 * Каждая точка входа обёрнута в try/catch: исключение нашего кода на чужом
 * сайте — инцидент у клиента (инвариант №1).
 */

import { guard, report } from "../core/guard";

const GLOBAL = "OnBoard";
const VERSION = "0.1.0";

// Таймаут запроса конфига — §9.1 docs/vision.md. Повтора в этой загрузке
// страницы нет: иначе медленный бэкенд получит шторм ретраев со всех страниц
// всех клиентов одновременно.
const CONFIG_TIMEOUT_MS = 3000;

export type LoaderConfig = {
  publicKey: string;
  apiUrl: string;
};

export type WidgetStep = {
  id: string;
  position: number;
  selector: string;
  title: string;
  body: string;
  placement: string;
};

export type WidgetTour = {
  id: string;
  name: string;
  show_once: boolean;
  steps: WidgetStep[];
};

export type WidgetConfig = {
  core_url: string;
  project: { theme: Record<string, string | number> };
  tour: WidgetTour | null;
};

type OnBoardGlobal = {
  version: string;
  config: LoaderConfig;
  /** Конфиг для ядра: оно читает его при старте, а не запрашивает снова. */
  boot?: WidgetConfig;
  /** Появляются вместе с ядром (§6 docs/conventions.md). */
  start?: () => void;
  stop?: () => void;
};

type HistoryMethod = "pushState" | "replaceState";

/** Параметры берутся с тега, который вставил клиент: `data-key` и `data-api`. */
export function readConfig(script: HTMLScriptElement | null): LoaderConfig | null {
  const publicKey = script?.dataset.key?.trim();
  const apiUrl = script?.dataset.api?.trim();
  if (!publicKey || !apiUrl) {
    return null;
  }
  return { publicKey, apiUrl: apiUrl.replace(/\/+$/, "") };
}

export function alreadyInitialised(target: Window): boolean {
  return Boolean((target as unknown as Record<string, unknown>)[GLOBAL]);
}

/**
 * Адрес страницы в том виде, в котором его сравнивают с условием показа:
 * `pathname + search`. `hash` в SPA меняется произвольно и в сравнении не
 * участвует, поэтому и отправлять его нашему API незачем (§6 docs/vision.md).
 */
export function pageUrl(location: Pick<Location, "pathname" | "search">): string {
  return `${location.pathname}${location.search}`;
}

export function configUrl(config: LoaderConfig, page: string): string {
  const params = new URLSearchParams({ key: config.publicKey, url: page });
  return `${config.apiUrl}/v1/public/config?${params.toString()}`;
}

/** Конфиг или null при любом отказе: причина уходит в `console.debug`. */
export async function fetchConfig(
  url: string,
  timeoutMs: number = CONFIG_TIMEOUT_MS,
): Promise<WidgetConfig | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: abort.signal,
      // Ни заголовков, ни cookie: простой GET обходится без preflight, а лишний
      // OPTIONS удвоил бы задержку до показа первого шага.
      credentials: "omit",
      mode: "cors",
    });
    if (!response.ok) {
      report("config_fetch_failed", response.status);
      return null;
    }
    return (await response.json()) as WidgetConfig;
  } catch (error) {
    // Повтора в этой загрузке страницы нет — см. комментарий у таймаута.
    report("config_fetch_failed", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Подгружает ядро тем же способом, которым клиент вставил нас: тегом script. */
export function loadCore(document: Document, src: string): void {
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  (document.head ?? document.documentElement).appendChild(script);
}

/**
 * Следит за сменой адреса в SPA.
 *
 * History API не сообщает о `pushState` и `replaceState` событиями, поэтому
 * обёртка — единственный способ о них узнать. Это записанное исключение из
 * инварианта №3 «встроенные объекты не патчим»: оригинал вызывается всегда,
 * его результат возвращается как есть, а при остановке метод возвращается
 * на место.
 *
 * Вызовы схлопываются: SPA часто делает `pushState`, а следом сразу
 * `replaceState` — реагировать стоит один раз, на итоговый адрес.
 */
export function watchUrl(target: Window, onChange: () => void): () => void {
  const history = target.history;
  const originals: Partial<Record<HistoryMethod, History["pushState"]>> = {};
  let scheduled = false;

  // Эта функция вызывается изнутри `pushState` сайта: исключение здесь
  // оборвало бы его навигацию.
  const schedule = guard("unexpected", () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    target.setTimeout(
      guard("unexpected", () => {
        scheduled = false;
        onChange();
      }),
      0,
    );
  });

  for (const name of ["pushState", "replaceState"] as HistoryMethod[]) {
    const original = history[name];
    originals[name] = original;
    history[name] = function (this: History, ...args: Parameters<History["pushState"]>) {
      // Сначала отдаём работу сайту и возвращаем его результат, потом свои дела.
      const result = original.apply(this, args);
      schedule();
      return result;
    };
  }

  target.addEventListener("popstate", schedule);

  return () => {
    for (const name of ["pushState", "replaceState"] as HistoryMethod[]) {
      const original = originals[name];
      // Если поверх нас встал кто-то ещё, чужую обёртку не срываем.
      if (original && history[name] !== original) {
        history[name] = original;
      }
    }
    target.removeEventListener("popstate", schedule);
  };
}

/**
 * Запрашивает конфиг для текущего адреса и приводит виджет в соответствие.
 *
 * На смене адреса виджет перезапускается целиком, а не донастраивается:
 * после перерисовки SPA прежний элемент шага может быть уже не на странице,
 * и подсветка считала бы геометрию мёртвого узла. Прогресс сохранён, поэтому
 * тур продолжится с того же шага (§3.3 docs/idea.md).
 */
export function createApplier(target: Window, api: OnBoardGlobal): () => Promise<void> {
  // Состояние живёт в замыкании, а не в модуле: это состояние одной страницы.
  let coreRequested = false;
  let lastUrl: string | null = null;

  return async function apply(): Promise<void> {
    try {
      const page = pageUrl(target.location);
      if (page === lastUrl) {
        // Сменился только hash или адрес переписали тем же значением.
        return;
      }
      lastUrl = page;

      const config = await fetchConfig(configUrl(api.config, page));
      if (!config) {
        return;
      }
      api.boot = config;

      if (!config.tour) {
        // Главная экономия двухэтапной загрузки: на страницах без тура ядро
        // не скачивается вовсе (ADR-0001). Если тур шёл — он сюда не относится.
        console.debug("[OnBoard] для этой страницы тура нет");
        api.stop?.();
        return;
      }

      if (!coreRequested) {
        coreRequested = true;
        loadCore(target.document, config.core_url);
        return;
      }
      // Ядро уже на странице: перезапускаем его с новым конфигом.
      api.start?.();
    } catch (error) {
      report("unexpected", error);
    }
  };
}

export function start(target: Window = window): void {
  try {
    // Сниппет вполне могут вставить дважды — в шаблон страницы и в шаблон
    // лэйаута. Два оверлея поверх одного элемента ломают сайт клиента.
    if (alreadyInitialised(target)) {
      return;
    }

    const script = target.document.currentScript as HTMLScriptElement | null;
    const config = readConfig(script);
    if (!config) {
      console.debug("[OnBoard] нет data-key или data-api — виджет не запускается");
      return;
    }

    const api: OnBoardGlobal = { version: VERSION, config };
    // Глобал ставится до запроса конфига: второй сниппет на той же странице
    // должен увидеть нас сразу, а не успеть отправить свой запрос.
    (target as unknown as Record<string, unknown>)[GLOBAL] = api;

    const apply = createApplier(target, api);
    void apply();
    // Переходы в SPA не перезагружают страницу, поэтому без этого тур
    // появлялся бы только после F5 — а в одностраничном приложении его
    // почти никто не нажимает.
    watchUrl(target, () => void apply());
  } catch (error) {
    report("unexpected", error);
  }
}

start();
