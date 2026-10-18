/**
 * Подсветка цели: затемнение области просмотра и «окно» в маске поверх
 * элемента (ADR-0003).
 *
 * Элемент клиента не меняется вообще — ни `position`, ни `z-index`, ни классы.
 * Подъём элемента над затемнением ломает `position: sticky` у хедеров и порядок
 * наложения внутри трансформированных контейнеров, а восстанавливать исходные
 * значения после тура приходится вручную (инварианты №2 и №3).
 *
 * Рисование и слежение разведены: когда пересчитывать — решает watcher.ts,
 * у которого тот же вопрос решается для подсказки.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Зазор между элементом и вырезом: иначе рамка ложится на границу элемента. */
export const HOLE_PADDING = 4;

/** Толщины двойной обводки — §4.4 docs/vision.md. */
const INNER_RING = 2;
const OUTER_RING = 3;

const DEFAULT_RADIUS = 8;

export type Overlay = {
  /** Ставит или переносит вырез на элемент. */
  draw: (element: Element) => void;
  stop: () => void;
};

export function radiusOf(value: string): number {
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

export function createOverlay(
  root: ShadowRoot,
  theme: { primaryColor: string; backdropOpacity: number; borderRadius: string },
): Overlay {
  const doc = root.ownerDocument;
  const radius = radiusOf(theme.borderRadius);

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "display: block; width: 100%; height: 100%;";

  const hole = rect(doc, { "data-part": "hole", fill: "#000", rx: String(radius) });
  const mask = doc.createElementNS(SVG_NS, "mask");
  // Идентификатор живёт внутри shadow root и с чужими не пересекается.
  mask.setAttribute("id", "onboard-hole");
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

  return {
    draw(element: Element): void {
      const box = element.getBoundingClientRect();
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
    },

    stop(): void {
      svg.remove();
    },
  };
}
