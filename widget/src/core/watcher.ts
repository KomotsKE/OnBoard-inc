/**
 * Слежение за геометрией страницы: когда пересчитывать положение подсветки
 * и подсказки.
 *
 * Отдельный модуль, потому что потребителей двое — оверлей и подсказка, — а
 * наблюдателей на странице клиента должно быть столько же, сколько при одном
 * (§6 docs/conventions.md).
 */

import { guard } from "./guard";

export type Watcher = {
  /** Начать следить за элементом; прежний отпускается. */
  watch: (element: Element) => void;
  stop: () => void;
};

export function createWatcher(doc: Document, onChange: () => void): Watcher {
  let target: Element | null = null;
  let frame: number | null = null;

  /** Пересчёт не чаще кадра: scroll и ResizeObserver приходят пачками. */
  // Пересчёт идёт в кадре, то есть вне нашего стека: исключение здесь улетело
  // бы в необработанные ошибки страницы клиента.
  const redraw = guard("render_failed", () => {
    frame = null;
    onChange();
  });

  function schedule(): void {
    if (frame !== null) {
      return;
    }
    frame = requestAnimationFrame(redraw);
  }

  // capture: true — события scroll не всплывают, но в фазе погружения доходят
  // до window от любого прокручиваемого контейнера внутри страницы.
  const scrollOptions = { passive: true, capture: true } as const;
  const view = doc.defaultView ?? window;
  view.addEventListener("scroll", schedule, scrollOptions);
  view.addEventListener("resize", schedule, { passive: true });

  // Размер цели и размер страницы: вставка контента выше цели двигает её
  // и меняет высоту документа.
  //
  // Опроса геометрии в бесконечном rAF-цикле нет: это та же граница, которую
  // по умолчанию держит floating-ui в autoUpdate. Цена — перемещение цели
  // чистым transform-переходом не отследим; взамен не жжём кадры всё время
  // тура на каждой странице клиента (ADR-0003).
  const sizes = new ResizeObserver(schedule);
  sizes.observe(doc.body);

  return {
    watch(element: Element): void {
      if (target && target !== element) {
        sizes.unobserve(target);
      }
      target = element;
      sizes.observe(element);
    },

    stop(): void {
      view.removeEventListener("scroll", schedule, scrollOptions);
      view.removeEventListener("resize", schedule);
      sizes.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      target = null;
    },
  };
}
