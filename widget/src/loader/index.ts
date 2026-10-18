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
  /** Конфиг для ядра: оно читает его при старте (T2.5), а не запрашивает снова. */
  boot?: WidgetConfig;
};

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
      console.debug("[OnBoard] конфиг не получен, код", response.status);
      return null;
    }
    return (await response.json()) as WidgetConfig;
  } catch (error) {
    console.debug("[OnBoard] конфиг недоступен", error);
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

async function boot(target: Window, api: OnBoardGlobal): Promise<void> {
  try {
    const config = await fetchConfig(configUrl(api.config, pageUrl(target.location)));
    if (!config) {
      return;
    }
    api.boot = config;
    if (!config.tour) {
      // Главная экономия двухэтапной загрузки: на страницах без тура ядро
      // не скачивается вовсе (ADR-0001).
      console.debug("[OnBoard] для этой страницы тура нет");
      return;
    }
    loadCore(target.document, config.core_url);
  } catch (error) {
    console.debug("[OnBoard] загрузка остановлена", error);
  }
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
    void boot(target, api);
  } catch (error) {
    console.debug("[OnBoard] загрузчик остановлен", error);
  }
}

start();
