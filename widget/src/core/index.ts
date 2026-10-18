/**
 * Ядро: движок тура. Подгружается загрузчиком только когда для текущего URL
 * есть опубликованный тур (ADR-0001), поэтому его размер не влияет на
 * страницы, где показывать нечего.
 *
 * Содержимое появляется в задачах T2.2–T2.8: поиск элемента, оверлей,
 * подсказка, конечный автомат шагов, отправка событий.
 */

export const CORE_VERSION = "0.1.0";

export { createResolver, isVisible, WAIT_TIMEOUT_MS } from "./resolver";
export type { MissingReason, Resolution, Resolver } from "./resolver";
