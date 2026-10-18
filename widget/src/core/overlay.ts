/**
 * Подсветка цели: затемнение области просмотра и «окно» в маске поверх
 * элемента (ADR-0003).
 *
 * Элемент клиента не меняется вообще — ни `position`, ни `z-index`, ни классы.
 * Подъём элемента над затемнением ломает `position: sticky` у хедеров и порядок
 * наложения внутри трансформированных контейнеров, а восстанавливать исходные
 * значения после тура приходится вручную (инварианты №2 и №3).
 *
 * Весь наш UI живёт в Shadow DOM под одним хостом в `<body>`: в документ клиента
 * не добавляется ни одного правила CSS (ADR-0002).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Значение зафиксировано в ADR-0002: воевать за максимум z-index бессмысленно. */
const HOST_Z_INDEX = 2147483000;

/** Зазор между элементом и вырезом: иначе рамка ложится на границу элемента. */
const HOLE_PADDING = 4;

/** Толщины двойной обводки — §4.4 docs/vision.md. */
const INNER_RING = 2;
const OUTER_RING = 3;

const DEFAULT_RADIUS = 8;

export type OverlayTheme = {
  primaryColor: string;
  backdropOpacity: number;
  /** Длина в px из темы проекта, например `8px`. */
  borderRadius: string;
};

export type Overlay = {
  /** Ставит или переносит вырез на элемент и начинает следить за геометрией. */
  highlight: (element: Element) => void;
  /** Снимает хост, слушатели и наблюдатели. После него страница как до нас. */
  stop: () => void;
};

function radiusOf(value: string): number {
  // Тема допускает любую строку длиной до 16 символов; геометрии SVG нужны
  // пиксели, поэтому всё, кроме px, заменяется значением по умолчанию.
  const parsed = Number.parseFloat(value);
  return value.trim().endsWith("px") && Number.isFinite(parsed) ? parsed : DEFAULT_RADIUS;
}

function rect(doc: Document, attributes: Record<string, string>): SVGRectElement {
  const node = doc.createElementNS(SVG_NS, "rect");
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  return node;
}

function place(node: SVGRectElement, x: number, y: number, width: number, height: number): void {
  node.setAttribute("x", String(x));
  node.setAttribute("y", String(y));
  // Отрицательная ширина — ошибка разметки SVG, а у схлопнутого элемента
  // прямоугольник вполне может оказаться нулевым.
  node.setAttribute("width", String(Math.max(width, 0)));
  node.setAttribute("height", String(Math.max(height, 0)));
}

export function createOverlay(doc: Document, theme: OverlayTheme): Overlay {
  const radius = radiusOf(theme.borderRadius);

  const host = doc.createElement("div");
  host.dataset.onboard = "overlay";
  // Чужому скринридеру затемнение не нужно; текст шага озвучивает подсказка (T2.4).
  host.setAttribute("aria-hidden", "true");
  // `all: initial` первым: он сбрасывает то, что мог навязать сброс стилей
  // клиента, а следующие свойства задают наше поведение (ADR-0002).
  host.style.cssText =
    "all: initial; position: fixed; inset: 0;" +
    ` z-index: ${HOST_Z_INDEX}; pointer-events: none;`;

  const root = host.attachShadow({ mode: "open" });

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.style.cssText = "display: block; width: 100%; height: 100%;";

  const hole = rect(doc, { "data-part": "hole", fill: "#000", rx: String(radius) });
  const mask = doc.createElementNS(SVG_NS, "mask");
  mask.setAttribute("id", "onboard-hole");
  // Идентификатор живёт внутри shadow root и с чужими не пересекается.
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  // Белое видно, чёрное вырезано: сначала открываем всё, потом пробиваем окно.
  mask.append(rect(doc, { x: "0", y: "0", width: "100%", height: "100%", fill: "#fff" }), hole);

  const defs = doc.createElementNS(SVG_NS, "defs");
  defs.append(mask);

  const backdrop = rect(doc, {
    "data-part": "backdrop",
    x: "0",
    y: "0",
    width: "100%",
    height: "100%",
    fill: "#000",
    opacity: String(theme.backdropOpacity),
    mask: "url(#onboard-hole)",
  });

  // Двойная обводка — следствие расчёта контраста, а не вкуса: брендовый цвет
  // на затемнённом фоне почти неразличим, белая обводка работает и на светлом
  // сайте, и на тёмном (§4.4 docs/vision.md).
  const outerRing = rect(doc, {
    "data-part": "ring-outer",
    fill: "none",
    stroke: "#fff",
    "stroke-width": String(OUTER_RING),
    rx: String(radius + OUTER_RING),
  });
  const innerRing = rect(doc, {
    "data-part": "ring-inner",
    fill: "none",
    stroke: theme.primaryColor,
    "stroke-width": String(INNER_RING),
    rx: String(radius),
  });

  svg.append(defs, backdrop, outerRing, innerRing);
  root.append(svg);
  doc.body.append(host);

  let target: Element | null = null;
  let frame: number | null = null;

  function draw(): void {
    if (!target) {
      return;
    }
    const box = target.getBoundingClientRect();
    const x = box.left - HOLE_PADDING;
    const y = box.top - HOLE_PADDING;
    const width = box.width + HOLE_PADDING * 2;
    const height = box.height + HOLE_PADDING * 2;

    place(hole, x, y, width, height);
    place(innerRing, x, y, width, height);
    // Обводка рисуется по центру контура, поэтому белая смещается наружу
    // ровно настолько, чтобы лечь вплотную к брендовой, без щели.
    const gap = (INNER_RING + OUTER_RING) / 2;
    place(outerRing, x - gap, y - gap, width + gap * 2, height + gap * 2);
  }

  /** Пересчёт не чаще кадра: scroll и ResizeObserver приходят пачками. */
  function schedule(): void {
    if (frame !== null) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      draw();
    });
  }

  // capture: true — события scroll не всплывают, но в фазе погружения доходят
  // до window от любого прокручиваемого контейнера внутри страницы.
  const scrollOptions = { passive: true, capture: true } as const;
  const view = doc.defaultView ?? window;
  view.addEventListener("scroll", schedule, scrollOptions);
  view.addEventListener("resize", schedule, { passive: true });

  // Следим за размером цели и за размером страницы: вставка контента выше цели
  // двигает её, и это меняет высоту документа.
  //
  // Опроса геометрии в бесконечном rAF-цикле нет: это та же граница, которую
  // по умолчанию держит floating-ui в autoUpdate. Цена — перемещение цели
  // чистым transform-переходом мы не отследим; взамен не жжём кадры на каждой
  // странице клиента всё время тура.
  const sizes = new ResizeObserver(schedule);
  sizes.observe(doc.body);

  return {
    highlight(element: Element): void {
      if (target && target !== element) {
        sizes.unobserve(target);
      }
      target = element;
      sizes.observe(element);
      // Сразу, а не через кадр: подсветка должна появиться вместе с шагом.
      draw();
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
      host.remove();
    },
  };
}
