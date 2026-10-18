/**
 * Подсказка шага: текст, прогресс, кнопки — и собственное позиционирование.
 *
 * Своё, а не библиотечное: у виджета ноль рантайм-зависимостей, а задача здесь
 * узкая — привязать прямоугольник к прямоугольнику, не вылезая за экран.
 * Расчёт вынесен в чистую функцию `place`, поэтому все развороты и сдвиги
 * проверяются без браузера и без вёрстки.
 */

export type Side = "top" | "bottom" | "left" | "right";
export type Placement = Side | "auto";

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

/** Ниже этой ширины подсказка превращается в панель у нижнего края. */
export const MOBILE_MAX_WIDTH = 480;
/** Расстояние от цели до подсказки. */
export const GAP = 12;
/** Минимальный отступ от края экрана. */
export const MARGIN = 8;
/** Сторона квадрата, повёрнутого на 45° — «носик» подсказки. */
export const ARROW = 10;

export type Placed =
  | { mode: "sheet" }
  | { mode: "anchored"; side: Side; left: number; top: number; arrowLeft: number; arrowTop: number };

const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

// Порядок для `auto`: снизу привычнее всего, сверху — вторая по привычности
// сторона, по бокам — когда по вертикали места нет совсем.
const AUTO_ORDER: Side[] = ["bottom", "top", "right", "left"];

function clamp(value: number, min: number, max: number): number {
  // Если места меньше, чем нужно, min оказывается больше max: предпочитаем
  // прижаться к началу, а не уехать за противоположный край.
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function freeSpace(target: Rect, viewport: Size): Record<Side, number> {
  return {
    top: target.top - GAP - MARGIN,
    bottom: viewport.height - (target.top + target.height) - GAP - MARGIN,
    left: target.left - GAP - MARGIN,
    right: viewport.width - (target.left + target.width) - GAP - MARGIN,
  };
}

function needed(tip: Size): Record<Side, number> {
  return { top: tip.height, bottom: tip.height, left: tip.width, right: tip.width };
}

function chooseSide(target: Rect, tip: Size, viewport: Size, preferred: Placement): Side {
  const space = freeSpace(target, viewport);
  const need = needed(tip);
  const order: Side[] =
    preferred === "auto" ? AUTO_ORDER : [preferred, OPPOSITE[preferred], ...AUTO_ORDER];

  const fits = order.find((side) => space[side] >= need[side]);
  if (fits) {
    return fits;
  }
  // Не влезает нигде — берём сторону с наибольшим запасом: подсказка всё равно
  // будет прижата к краю, и лучше прижать там, где она перекроет меньше.
  return order.reduce((best, side) => (space[side] > space[best] ? side : best), order[0] as Side);
}

export function place(target: Rect, tip: Size, viewport: Size, preferred: Placement): Placed {
  if (viewport.width < MOBILE_MAX_WIDTH) {
    return { mode: "sheet" };
  }

  const side = chooseSide(target, tip, viewport, preferred);
  const centerX = target.left + target.width / 2;
  const centerY = target.top + target.height / 2;

  let left: number;
  let top: number;
  if (side === "bottom" || side === "top") {
    left = clamp(centerX - tip.width / 2, MARGIN, viewport.width - tip.width - MARGIN);
    top = side === "bottom" ? target.top + target.height + GAP : target.top - GAP - tip.height;
  } else {
    left = side === "right" ? target.left + target.width + GAP : target.left - GAP - tip.width;
    top = clamp(centerY - tip.height / 2, MARGIN, viewport.height - tip.height - MARGIN);
  }
  top = clamp(top, MARGIN, Math.max(MARGIN, viewport.height - tip.height - MARGIN));
  left = clamp(left, MARGIN, Math.max(MARGIN, viewport.width - tip.width - MARGIN));

  // Носик всегда смотрит на цель, но не сползает с подсказки: у скруглённого
  // угла ему делать нечего.
  const inset = ARROW;
  const arrowLeft =
    side === "bottom" || side === "top"
      ? clamp(centerX - ARROW / 2, left + inset, left + tip.width - ARROW - inset)
      : side === "right"
        ? left - ARROW / 2
        : left + tip.width - ARROW / 2;
  const arrowTop =
    side === "left" || side === "right"
      ? clamp(centerY - ARROW / 2, top + inset, top + tip.height - ARROW - inset)
      : side === "bottom"
        ? top - ARROW / 2
        : top + tip.height - ARROW / 2;

  return { mode: "anchored", side, left, top, arrowLeft, arrowTop };
}

export type TooltipStep = { title: string; body: string; placement: Placement };
export type TooltipLabels = { next: string; skip: string; done: string };
export type TooltipHandlers = { onNext: () => void; onBack: () => void; onSkip: () => void };

export type Tooltip = {
  show: (step: TooltipStep, target: Element, state: { index: number; total: number }) => void;
  /** Пересчитать положение: вызывается наблюдателем за геометрией. */
  reposition: () => void;
  stop: () => void;
};

export function createTooltip(
  root: ShadowRoot,
  labels: TooltipLabels,
  handlers: TooltipHandlers,
): Tooltip {
  const doc = root.ownerDocument;

  const tip = doc.createElement("div");
  tip.className = "tip";
  tip.dataset.part = "tip";
  tip.setAttribute("role", "dialog");
  // Не modal: страница под подсказкой остаётся доступной, целевой элемент
  // кликабелен и виден.
  tip.setAttribute("aria-modal", "false");
  // Фокус переводится на саму подсказку при показе шага — этого достаточно,
  // чтобы скринридер прочитал её целиком. `aria-live` на том же узле дал бы
  // второе чтение того же текста.
  tip.tabIndex = -1;
  tip.hidden = true;

  const arrow = doc.createElement("div");
  arrow.className = "tip__arrow";
  arrow.dataset.part = "arrow";

  const title = doc.createElement("p");
  title.className = "tip__title";
  title.dataset.part = "title";
  title.id = "onboard-tip-title";
  tip.setAttribute("aria-labelledby", title.id);

  const body = doc.createElement("p");
  body.className = "tip__body";
  body.dataset.part = "body";
  body.id = "onboard-tip-body";
  tip.setAttribute("aria-describedby", body.id);

  const dots = doc.createElement("div");
  dots.className = "tip__dots";
  dots.dataset.part = "dots";

  // Точки прогресса скринридер не озвучивает: номер шага нужен словами.
  const progress = doc.createElement("span");
  progress.className = "tip__progress";
  progress.dataset.part = "progress";

  const back = doc.createElement("button");
  back.type = "button";
  back.className = "tip__button tip__button--ghost";
  back.dataset.part = "back";
  back.textContent = "Назад";
  back.addEventListener("click", () => handlers.onBack());

  const skip = doc.createElement("button");
  skip.type = "button";
  skip.className = "tip__button tip__button--ghost";
  skip.dataset.part = "skip";
  skip.addEventListener("click", () => handlers.onSkip());

  const next = doc.createElement("button");
  next.type = "button";
  next.className = "tip__button tip__button--primary";
  next.dataset.part = "next";
  next.addEventListener("click", () => handlers.onNext());

  const footer = doc.createElement("div");
  footer.className = "tip__footer";
  footer.append(dots, skip, back, next);

  // Текст для скринридера стоит вне точек: `drawDots` очищает свой контейнер
  // целиком, и внутри он затирался бы на каждом шаге.
  tip.append(arrow, title, body, progress, footer);
  root.append(tip);

  let target: Element | null = null;
  let placement: Placement = "auto";
  // Куда вернуть фокус, когда тур закончится: забираем фокус у страницы —
  // обязаны и отдать.
  let focusWasOn: Element | null = null;

  function buttons(): HTMLElement[] {
    return [skip, back, next].filter((button) => !button.hidden);
  }

  /**
   * Клавиатура подсказки.
   *
   * Tab ходит по кругу внутри подсказки: иначе посетитель, дойдя до последней
   * кнопки, «проваливается» в страницу под затемнением и не понимает, где он.
   * Esc слушается на документе, а не на подсказке: пропустить тур нужно и
   * тогда, когда фокус остался на странице.
   */
  function onTipKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      handlers.onNext();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      handlers.onBack();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const order = buttons();
    if (order.length === 0) {
      return;
    }
    const root = tip.getRootNode() as ShadowRoot;
    const index = order.indexOf(root.activeElement as HTMLElement);
    const last = order.length - 1;
    const atEdge = event.shiftKey ? index <= 0 : index === last;
    if (!atEdge) {
      return;
    }
    event.preventDefault();
    (event.shiftKey ? order[last] : order[0])?.focus();
  }

  function onDocumentKeydown(event: KeyboardEvent): void {
    // Ни preventDefault, ни остановки всплытия: у страницы клиента может быть
    // своя модалка, и закрываться по Esc она должна так же, как без нас.
    // Отменять у Escape, по сути, нечего, а чужие обработчики — не наши.
    if (event.key === "Escape" && !tip.hidden) {
      handlers.onSkip();
    }
  }

  tip.addEventListener("keydown", onTipKeydown);
  doc.addEventListener("keydown", onDocumentKeydown, true);

  function drawDots(index: number, total: number): void {
    dots.textContent = "";
    for (let position = 0; position < total; position += 1) {
      const dot = doc.createElement("span");
      dot.className = "tip__dot";
      if (position === index) {
        dot.dataset.current = "";
      }
      dots.append(dot);
    }
  }

  function reposition(): void {
    if (!target || tip.hidden) {
      return;
    }
    const view = doc.defaultView ?? window;
    const result = place(
      target.getBoundingClientRect(),
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: view.innerWidth, height: view.innerHeight },
      placement,
    );

    if (result.mode === "sheet") {
      // Узкий экран: панель у нижнего края во всю ширину. Привязка к цели
      // на 375 px даёт подсказку, которая всё равно перекрывает пол-экрана.
      tip.style.cssText = `left: ${MARGIN}px; right: ${MARGIN}px; bottom: ${MARGIN}px; top: auto; max-width: none;`;
      arrow.hidden = true;
      return;
    }

    tip.style.cssText = `left: ${result.left}px; top: ${result.top}px;`;
    arrow.hidden = false;
    arrow.style.cssText = `left: ${result.arrowLeft}px; top: ${result.arrowTop}px;`;
  }

  return {
    show(step, element, state): void {
      target = element;
      placement = step.placement;
      // Только textContent: текст шага пишет владелец сайта, и он не должен
      // становиться разметкой на странице его посетителя (инвариант №6).
      title.textContent = step.title;
      body.textContent = step.body;
      skip.textContent = labels.skip;
      // На первом шаге возвращаться некуда, и пустая кнопка только мешает.
      back.hidden = state.index === 0;
      next.textContent = state.index + 1 >= state.total ? labels.done : labels.next;
      drawDots(state.index, state.total);
      progress.textContent = `Шаг ${state.index + 1} из ${state.total}`;

      // Показать до замера: у скрытого элемента нет размеров, а положение
      // считается от размеров подсказки.
      tip.hidden = false;
      reposition();

      if (focusWasOn === null) {
        focusWasOn = doc.activeElement;
      }
      // Фокус на подсказке: шаг читается скринридером, и дальше работает
      // клавиатура, а не только мышь.
      tip.focus({ preventScroll: true });
    },

    reposition,

    stop(): void {
      target = null;
      tip.removeEventListener("keydown", onTipKeydown);
      doc.removeEventListener("keydown", onDocumentKeydown, true);
      tip.remove();
      // Возвращаем фокус туда, где он был до тура: иначе посетитель
      // продолжает с начала страницы.
      if (focusWasOn instanceof HTMLElement) {
        focusWasOn.focus({ preventScroll: true });
      }
      focusWasOn = null;
    },
  };
}
