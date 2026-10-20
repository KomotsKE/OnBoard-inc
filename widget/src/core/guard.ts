/**
 * Защитный контур: исключение нашего кода на чужом сайте — это инцидент
 * у клиента, а не у нас (инвариант №1).
 *
 * Через `guard` проходит каждая точка входа, которую вызывает не наш код:
 * слушатели событий, наблюдатели, колбэки кадра и таймеров, публичные методы
 * `window.OnBoard`. Внутри своих функций try/catch не рассыпаем — ловим там,
 * где граница с чужим кодом.
 *
 * Коды — §7.2 docs/vision.md. Кроме записи в консоль ошибка уходит событием
 * `widget_error`: консоль браузера посетителя нам недоступна, и это
 * единственный способ узнать, что виджет у клиента падает.
 */

export type ErrorCode =
  | "config_fetch_failed"
  | "render_failed"
  | "storage_unavailable"
  | "target_timeout"
  /** Запрос редактора не удался: в аналитику не уходит, только в консоль. */
  | "editor_request_failed"
  | "unexpected";

/** Куда уходят ошибки кроме консоли. Ставится ядром на время тура. */
let sink: ((code: ErrorCode) => void) | null = null;

export function setErrorSink(handler: ((code: ErrorCode) => void) | null): void {
  sink = handler;
}

/** Единственное место, где виджет сообщает о своей ошибке. */
export function report(code: ErrorCode, detail: unknown): void {
  // Чужая консоль — не наше место для диагностики: только console.debug
  // с префиксом (§6 docs/conventions.md).
  console.debug(`[OnBoard] ${code}`, detail);
  try {
    // Уходит только код: ни стектрейсов, ни содержимого страницы,
    // ни параметров адреса (§7.1 docs/vision.md).
    sink?.(code);
  } catch {
    // Отправка не имеет права ломать то, что сообщает об ошибке.
  }
}

export function guard<A extends unknown[]>(
  code: ErrorCode,
  fn: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (error) {
      report(code, error);
    }
  };
}
