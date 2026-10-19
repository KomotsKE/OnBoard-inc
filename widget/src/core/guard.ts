/**
 * Защитный контур: исключение нашего кода на чужом сайте — это инцидент
 * у клиента, а не у нас (инвариант №1).
 *
 * Через `guard` проходит каждая точка входа, которую вызывает не наш код:
 * слушатели событий, наблюдатели, колбэки кадра и таймеров, публичные методы
 * `window.OnBoard`. Внутри своих функций try/catch не рассыпаем — ловим там,
 * где граница с чужим кодом.
 *
 * Коды — §7.2 docs/vision.md. Отправку события `widget_error` добавит T4.2:
 * сейчас транспорта событий нет, а выдумывать его заранее незачем.
 */

export type ErrorCode =
  | "config_fetch_failed"
  | "render_failed"
  | "storage_unavailable"
  | "target_timeout"
  | "unexpected";

/** Единственное место, где виджет сообщает о своей ошибке. */
export function report(code: ErrorCode, detail: unknown): void {
  // Чужая консоль — не наше место для диагностики: только console.debug
  // с префиксом (§6 docs/conventions.md).
  console.debug(`[OnBoard] ${code}`, detail);
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
