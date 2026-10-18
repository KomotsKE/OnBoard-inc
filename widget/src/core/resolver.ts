/**
 * Поиск целевого элемента шага на чужой странице.
 *
 * Элемента может не быть в тот момент, когда шаг показывают: страница ещё
 * рендерится, данные ещё грузятся, аккордеон ещё закрыт. Поэтому поиск — это
 * ожидание с пределом (10 с, §9.1 docs/vision.md), а не одна попытка: «шаг
 * сломан» на странице, где элемент появится через секунду, — худший из
 * возможных ответов и для посетителя, и для владельца сайта.
 */

/** Предел ожидания элемента — §9.1 docs/vision.md. */
export const WAIT_TIMEOUT_MS = 10_000;

export type MissingReason =
  /** Селектор не нашёл ничего за отведённое время. */
  | "not_found"
  /** Элемент в разметке есть, но он скрыт — владельцу это полезно знать. */
  | "hidden"
  /** Селектор не разбирается браузером: ждать нечего. */
  | "invalid_selector"
  /** Ожидание прервано: тур закрыли или перешли к другому шагу. */
  | "cancelled";

export type Resolution =
  | { status: "found"; element: Element }
  | { status: "missing"; reason: MissingReason };

type VisibilityOptions = { checkOpacity?: boolean; checkVisibilityCSS?: boolean };
type MaybeCheckable = Element & { checkVisibility?: (options?: VisibilityOptions) => boolean };

/**
 * Видим ли элемент настолько, чтобы к нему можно было привязать подсказку.
 *
 * Считает браузер, а не мы: `checkVisibility` учитывает скрытых предков, а
 * собственная проверка стилей такой случай пропустила бы. Измерено в Chromium:
 * у кнопки внутри `display: none` вычисленный `display` равен `inline-block`,
 * а не `none`, — проверка «не none ли display» назвала бы её видимой.
 *
 * Геометрия здесь не проверяется: нулевой размер и положение за пределами
 * экрана — вопрос оверлея, который умеет прокручивать к элементу (T2.3).
 */
export function isVisible(element: Element): boolean {
  const candidate = element as MaybeCheckable;
  if (typeof candidate.checkVisibility === "function") {
    return candidate.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  // Safari до 17.4: отсутствие прямоугольников — тот же признак, только грубее.
  // `display: none` и `[hidden]` он ловит (прямоугольников нет), а `opacity: 0`
  // нет — прозрачность не влияет на раскладку.
  return element.getClientRects().length > 0;
}

/**
 * Первый видимый элемент по селектору.
 *
 * Именно видимый: один и тот же селектор на адаптивной вёрстке часто попадает
 * сразу в два узла — в скрытое мобильное меню и в настоящий хедер. Подсветить
 * скрытый дубль хуже, чем не подсветить ничего.
 */
export function findVisible(root: ParentNode, selector: string): Element | null {
  for (const candidate of root.querySelectorAll(selector)) {
    if (isVisible(candidate)) {
      return candidate;
    }
  }
  return null;
}

export type Resolver = {
  resolve: (selector: string, timeoutMs?: number) => Promise<Resolution>;
  stop: () => void;
};

export function createResolver(root: Document = document): Resolver {
  // Ожидание всегда одно: наблюдатель от брошенного шага иначе остался бы
  // висеть на документе клиента, а утечка наблюдателей на SPA накапливается
  // молча (§6 docs/conventions.md).
  let cancel: (() => void) | null = null;

  function stop(): void {
    cancel?.();
  }

  function resolve(selector: string, timeoutMs: number = WAIT_TIMEOUT_MS): Promise<Resolution> {
    stop();

    let present: Element | null;
    try {
      present = findVisible(root, selector);
    } catch {
      // Неразбираемый селектор не станет разбираемым через десять секунд.
      return Promise.resolve({ status: "missing", reason: "invalid_selector" });
    }
    if (present) {
      return Promise.resolve({ status: "found", element: present });
    }

    return new Promise<Resolution>((settle) => {
      let done = false;

      const finish = (resolution: Resolution): void => {
        if (done) {
          return;
        }
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        cancel = null;
        settle(resolution);
      };

      // Один querySelectorAll на пачку изменений. Наблюдаем и за появлением
      // узлов, и за атрибутами: элемент часто уже есть в разметке и лишь скрыт
      // классом или [hidden], и тогда «появление» — это смена атрибута.
      const observer = new MutationObserver(() => {
        const element = findVisible(root, selector);
        if (element) {
          finish({ status: "found", element });
        }
      });

      const timer = setTimeout(() => {
        // Различаем «ничего не нашлось» и «нашлось, но скрыто»: для владельца
        // сайта это две разные причины и два разных исправления.
        const reason: MissingReason = root.querySelector(selector) ? "hidden" : "not_found";
        finish({ status: "missing", reason });
      }, timeoutMs);

      cancel = () => finish({ status: "missing", reason: "cancelled" });

      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden"],
      });
    });
  }

  return { resolve, stop };
}
