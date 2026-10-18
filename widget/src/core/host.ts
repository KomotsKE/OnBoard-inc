/**
 * Хост виджета: единственный наш элемент в документе клиента и открытый
 * shadow root под ним (ADR-0002).
 *
 * Внутри живёт всё: затемнение с вырезом и подсказка. В документ клиента не
 * добавляется ни одного правила CSS — ни наши стили не достают до его вёрстки,
 * ни его сбросы и `!important` до нашей.
 */

/** Значение зафиксировано в ADR-0002: воевать за максимум z-index бессмысленно. */
const HOST_Z_INDEX = 2147483000;

export type WidgetTheme = {
  primaryColor: string;
  textColor: string;
  backdropOpacity: number;
  borderRadius: string;
  fontFamily: string;
};

export type WidgetHost = {
  root: ShadowRoot;
  stop: () => void;
};

// Стили подсказки. Позиционированием они не занимаются: координаты считает
// `place()` в tooltip.ts, и единственный способ не разойтись с ним — не иметь
// второго источника правды в CSS.
const STYLES = `
:host { all: initial; }
.tip {
  position: fixed;
  box-sizing: border-box;
  max-width: 320px;
  padding: 16px;
  background: #fff;
  color: var(--onboard-text, #0F172A);
  font: 14px/1.45 var(--onboard-font, system-ui, sans-serif);
  border-radius: var(--onboard-radius, 8px);
  box-shadow: 0 12px 32px rgb(15 23 42 / 28%);
  /* Хост событий не ловит, подсказка — ловит: иначе по кнопкам не нажать. */
  pointer-events: auto;
}
.tip[hidden] { display: none; }
.tip__arrow {
  position: fixed;
  width: 10px;
  height: 10px;
  background: #fff;
  transform: rotate(45deg);
}
.tip__title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: inherit;
}
.tip__title:empty { display: none; }
.tip__body {
  margin: 0;
  /* Переводы строк в тексте шага — часть текста, который написал владелец. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.tip__footer {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.tip__dots { display: flex; gap: 5px; margin-right: auto; }
.tip__dot { width: 6px; height: 6px; border-radius: 50%; background: #CBD5E1; }
.tip__dot[data-current] { background: var(--onboard-primary, #2563EB); }
.tip__button {
  box-sizing: border-box;
  padding: 8px 14px;
  border: 0;
  border-radius: var(--onboard-radius, 8px);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.tip__button--primary { background: var(--onboard-primary, #2563EB); color: #fff; }
.tip__button--ghost { background: transparent; color: #64748B; font-weight: 500; }
.tip__button:focus-visible { outline: 2px solid var(--onboard-primary, #2563EB); outline-offset: 2px; }
`;

function applyStyles(root: ShadowRoot, doc: Document): void {
  // adoptedStyleSheets — без лишнего узла в дереве; где его нет (Safari до 16.4,
  // jsdom) — обычный <style>, но тоже внутри shadow root.
  if ("adoptedStyleSheets" in root && typeof CSSStyleSheet === "function") {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      root.adoptedStyleSheets = [sheet];
      return;
    } catch {
      // Конструируемые таблицы бывают запрещены политикой страницы — тогда
      // работает тот же запасной путь.
    }
  }
  const style = doc.createElement("style");
  style.textContent = STYLES;
  root.append(style);
}

export function createHost(doc: Document, theme: WidgetTheme): WidgetHost {
  const host = doc.createElement("div");
  host.dataset.onboard = "host";
  // Затемнение и рамка — украшение; текст шага озвучивает сама подсказка.
  host.setAttribute("aria-hidden", "false");
  host.style.cssText =
    `all: initial; position: fixed; inset: 0; z-index: ${HOST_Z_INDEX}; pointer-events: none;`;

  // Значения темы задаются через setProperty, а не склейкой строки стиля:
  // в теме есть свободный текст (шрифт), и склейка позволила бы подмешать
  // в наш же стиль посторонние свойства.
  host.style.setProperty("--onboard-primary", theme.primaryColor);
  host.style.setProperty("--onboard-text", theme.textColor);
  host.style.setProperty("--onboard-radius", theme.borderRadius);
  host.style.setProperty("--onboard-font", theme.fontFamily);

  const root = host.attachShadow({ mode: "open" });
  applyStyles(root, doc);
  doc.body.append(host);

  return {
    root,
    stop(): void {
      host.remove();
    },
  };
}
