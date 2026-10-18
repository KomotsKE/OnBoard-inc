/**
 * Движок тура: какой шаг показан, куда ведут кнопки и когда тур заканчивается.
 *
 * Про DOM знает только через переданные ему подсветку, подсказку и наблюдателя
 * за геометрией — поэтому переходы проверяются без браузера.
 */

import type { Overlay } from "./overlay";
import type { ProgressStore, TourProgress } from "./progress";
import type { Resolver } from "./resolver";
import type { Placement, Tooltip } from "./tooltip";
import type { Watcher } from "./watcher";

export type EngineStep = {
  id: string;
  selector: string;
  title: string;
  body: string;
  placement: Placement;
};

export type EngineTour = {
  id: string;
  show_once: boolean;
  steps: EngineStep[];
};

/** Чем закончился показ тура — пригодится событиям аналитики (T4.1). */
export type FinishReason = "completed" | "skipped" | "target_missing";

export type Engine = {
  /** Показать шаг, с которого начинается или продолжается тур. */
  start: (from?: number) => Promise<void>;
  next: () => Promise<void>;
  back: () => Promise<void>;
  skip: () => void;
  /** Элемент текущего шага: нужен тому, кто пересчитывает геометрию. */
  current: () => Element | null;
  /** Остановить снаружи: прогресс не трогаем, решение не посетителя. */
  stop: () => void;
};

export type EngineDeps = {
  resolver: Resolver;
  overlay: Overlay;
  tooltip: Tooltip;
  watcher: Watcher;
  progress: ProgressStore;
  /** Окно страницы клиента: нужно, чтобы понять, видна ли цель. */
  view: Window;
  /** Снять хост и освободить ресурсы: это дело ядра, а не движка. */
  onFinish: (reason: FinishReason) => void;
};

/**
 * Прокрутить страницу к цели, если она за пределами экрана.
 *
 * Единственное место, где движок трогает DOM напрямую. Без этого шаг, цель
 * которого ниже сгиба, подсвечивался бы за экраном: посетитель видел бы
 * затемнение и подсказку, но не то, о чём она рассказывает. Уже видимую цель
 * не трогаем — дёргать чужую страницу без нужды нельзя.
 */
export function bringIntoView(element: Element, view: Window): void {
  const box = element.getBoundingClientRect();
  const visible = box.top >= 0 && box.bottom <= view.innerHeight;
  if (visible || typeof element.scrollIntoView !== "function") {
    return;
  }
  // `instant`, а не `smooth`: плавная прокрутка идёт кадрами, и подсветка
  // считала бы геометрию по дороге.
  element.scrollIntoView({ block: "center", behavior: "instant" });
}

/**
 * С какого шага показывать тур и показывать ли вообще.
 *
 * `null` — показывать не нужно. Сохранённый шаг старше тура (шаги удалили)
 * приводится к границам: иначе правка тура в панели оставила бы посетителя
 * с прогрессом, который некуда приложить.
 */
export function resumeIndex(tour: EngineTour, saved: TourProgress | null): number | null {
  if (tour.steps.length === 0) {
    return null;
  }
  if (!saved) {
    return 0;
  }
  if (saved.done) {
    return tour.show_once ? null : 0;
  }
  return Math.min(Math.max(saved.step, 0), tour.steps.length - 1);
}

export function createEngine(tour: EngineTour, deps: EngineDeps): Engine {
  let index = 0;
  let stopped = false;
  let busy = false;
  let element: Element | null = null;

  function save(done: boolean): void {
    deps.progress.write(tour.id, { step: index, done });
  }

  function finish(reason: FinishReason): void {
    if (stopped) {
      return;
    }
    stopped = true;
    // Ненайденная цель — поломка на стороне сайта, а не решение посетителя:
    // тур не помечается пройденным, чтобы показаться снова, когда вёрстку
    // починят (§3.3 docs/idea.md).
    save(reason !== "target_missing");
    deps.onFinish(reason);
  }

  async function go(next: number): Promise<void> {
    // Пока шаг ищется, кнопки молчат: элемент шага может появляться секунды,
    // и второй клик по «Далее» иначе сдвигал бы счётчик ещё раз — посетитель
    // проскакивал бы шаг, так его и не увидев.
    if (stopped || busy) {
      return;
    }
    busy = true;
    index = next;
    const step = tour.steps[index];
    if (!step) {
      busy = false;
      finish("completed");
      return;
    }

    const resolution = await deps.resolver.resolve(step.selector);
    busy = false;
    if (stopped) {
      return;
    }
    if (resolution.status !== "found") {
      // Пустая подсказка без подсветки хуже, чем закрытый тур.
      console.debug("[OnBoard] цель шага не найдена:", step.selector, resolution.reason);
      finish("target_missing");
      return;
    }

    element = resolution.element;
    bringIntoView(element, deps.view);
    deps.overlay.draw(element);
    deps.tooltip.show(step, element, { index, total: tour.steps.length });
    deps.watcher.watch(element);
    save(false);
  }

  return {
    start: (from = 0) => go(from),

    next: async () => {
      const next = index + 1;
      if (next >= tour.steps.length) {
        finish("completed");
        return;
      }
      await go(next);
    },

    back: () => go(Math.max(index - 1, 0)),

    current: () => element,

    skip: () => finish("skipped"),

    stop: () => {
      stopped = true;
    },
  };
}
