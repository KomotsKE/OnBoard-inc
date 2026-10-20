/**
 * Интерфейс редактора: подсветка, панель со списком шагов и форма шага.
 *
 * Как и тур, весь UI живёт в Shadow DOM под одним хостом в `<body>`
 * (ADR-0002): ни одного правила CSS в документ клиента. Текст шага и имя
 * тура ставятся только через `textContent` (инвариант №6).
 */

import type { EditorStep } from "./session";

const HOST_Z_INDEX = 2147483000;

const STYLES = `
:host { all: initial; }
.frame {
  position: fixed;
  box-sizing: border-box;
  border: 2px solid #2563EB;
  background: rgb(37 99 235 / 12%);
  border-radius: 4px;
  pointer-events: none;
}
.frame[hidden] { display: none; }
.panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  box-sizing: border-box;
  width: 320px;
  max-height: 70vh;
  overflow: auto;
  padding: 16px;
  background: #fff;
  color: #0F172A;
  font: 14px/1.45 system-ui, sans-serif;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgb(15 23 42 / 28%);
  pointer-events: auto;
}
.panel__title { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.panel__hint { margin: 0 0 12px; color: #475569; }
.panel__selector {
  display: block;
  margin: 0 0 10px;
  padding: 6px 8px;
  background: #F1F5F9;
  border-radius: 6px;
  font: 12px/1.4 ui-monospace, monospace;
  overflow-wrap: anywhere;
}
.panel__steps { margin: 0 0 12px; padding-left: 20px; }
.panel__steps:empty { display: none; }
.panel__steps li { margin-bottom: 4px; overflow-wrap: anywhere; }
.panel__field { display: block; margin-bottom: 8px; }
.panel__field span { display: block; margin-bottom: 4px; color: #475569; }
.panel__field input, .panel__field textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid #CBD5E1;
  border-radius: 6px;
  font: inherit;
}
.panel__row { display: flex; gap: 8px; margin-top: 10px; }
.panel__button {
  padding: 8px 14px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.panel__button--primary { background: #2563EB; color: #fff; }
.panel__button--ghost { background: transparent; color: #475569; font-weight: 500; }
.panel__status { margin: 8px 0 0; color: #B91C1C; }
.panel__status:empty { display: none; }
[hidden] { display: none !important; }
`;

export type StepDraft = { title: string; body: string };

export type EditorUiHandlers = {
  onAdd: (draft: StepDraft) => void;
  onDone: () => void;
};

export type EditorUi = {
  owns: (node: EventTarget | null) => boolean;
  highlight: (rect: DOMRect | null) => void;
  showSelector: (selector: string | null) => void;
  openForm: () => void;
  addStep: (step: EditorStep) => void;
  setStatus: (text: string) => void;
  stop: () => void;
};

function field(doc: Document, label: string, control: HTMLElement): HTMLLabelElement {
  const wrapper = doc.createElement("label");
  wrapper.className = "panel__field";
  const caption = doc.createElement("span");
  caption.textContent = label;
  wrapper.append(caption, control);
  return wrapper;
}

function button(doc: Document, text: string, kind: "primary" | "ghost"): HTMLButtonElement {
  const element = doc.createElement("button");
  element.type = "button";
  element.className = `panel__button panel__button--${kind}`;
  element.textContent = text;
  return element;
}

function stepItem(doc: Document, step: EditorStep): HTMLLIElement {
  const item = doc.createElement("li");
  item.dataset.part = "step";
  item.textContent = step.title ? `${step.title} — ${step.body}` : step.body;
  return item;
}

function applyStyles(root: ShadowRoot, doc: Document): void {
  // Тот же запасной путь, что и у тура: конструируемые таблицы бывают
  // запрещены политикой страницы, а jsdom их не знает вовсе.
  if ("adoptedStyleSheets" in root && typeof CSSStyleSheet === "function") {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      root.adoptedStyleSheets = [sheet];
      return;
    } catch {
      // Запасной путь ниже.
    }
  }
  const style = doc.createElement("style");
  style.textContent = STYLES;
  root.append(style);
}

export function createEditorUi(
  doc: Document,
  tour: { name: string },
  steps: EditorStep[],
  handlers: EditorUiHandlers,
): EditorUi {
  const host = doc.createElement("div");
  host.dataset.onboard = "editor";
  host.style.cssText =
    `all: initial; position: fixed; inset: 0; z-index: ${HOST_Z_INDEX}; pointer-events: none;`;
  const root = host.attachShadow({ mode: "open" });
  applyStyles(root, doc);

  const frame = doc.createElement("div");
  frame.className = "frame";
  frame.dataset.part = "frame";
  frame.hidden = true;

  const panel = doc.createElement("aside");
  panel.className = "panel";
  panel.dataset.part = "panel";

  const title = doc.createElement("p");
  title.className = "panel__title";
  title.textContent = tour.name;

  const hint = doc.createElement("p");
  hint.className = "panel__hint";
  hint.dataset.part = "hint";
  hint.textContent = "Наведите на элемент и нажмите — он станет шагом тура.";

  const selector = doc.createElement("code");
  selector.className = "panel__selector";
  selector.dataset.part = "selector";
  selector.hidden = true;

  const list = doc.createElement("ol");
  list.className = "panel__steps";
  list.dataset.part = "steps";
  for (const step of steps) {
    list.append(stepItem(doc, step));
  }

  const form = doc.createElement("form");
  form.dataset.part = "form";
  form.hidden = true;
  const titleInput = doc.createElement("input");
  titleInput.dataset.part = "step-title";
  titleInput.maxLength = 80;
  const bodyInput = doc.createElement("textarea");
  bodyInput.dataset.part = "step-body";
  bodyInput.rows = 3;
  bodyInput.maxLength = 500;
  const submit = button(doc, "Добавить шаг", "primary");
  submit.type = "submit";
  const cancel = button(doc, "Отмена", "ghost");
  const row = doc.createElement("div");
  row.className = "panel__row";
  row.append(submit, cancel);
  form.append(
    field(doc, "Заголовок, необязательно", titleInput),
    field(doc, "Текст подсказки", bodyInput),
    row,
  );

  const status = doc.createElement("p");
  status.className = "panel__status";
  status.dataset.part = "status";
  status.setAttribute("role", "alert");

  const done = button(doc, "Готово", "ghost");
  done.dataset.part = "done";
  const footer = doc.createElement("div");
  footer.className = "panel__row";
  footer.append(done);

  panel.append(title, hint, selector, list, form, status, footer);
  root.append(frame, panel);
  doc.body.append(host);

  function closeForm(): void {
    form.hidden = true;
    titleInput.value = "";
    bodyInput.value = "";
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = bodyInput.value.trim();
    if (!body) {
      status.textContent = "Текст подсказки обязателен";
      return;
    }
    status.textContent = "";
    handlers.onAdd({ title: titleInput.value.trim(), body });
  });
  cancel.addEventListener("click", () => {
    status.textContent = "";
    closeForm();
  });
  done.addEventListener("click", () => handlers.onDone());

  return {
    owns: (node) => node instanceof Node && host.contains(node),
    highlight(rect: DOMRect | null): void {
      if (rect === null) {
        frame.hidden = true;
        return;
      }
      frame.hidden = false;
      frame.style.left = `${rect.left}px`;
      frame.style.top = `${rect.top}px`;
      frame.style.width = `${rect.width}px`;
      frame.style.height = `${rect.height}px`;
    },
    showSelector(value: string | null): void {
      selector.hidden = value === null;
      selector.textContent = value ?? "";
    },
    openForm(): void {
      form.hidden = false;
      bodyInput.focus();
    },
    addStep(step: EditorStep): void {
      list.append(stepItem(doc, step));
      closeForm();
    },
    setStatus(text: string): void {
      status.textContent = text;
    },
    stop(): void {
      host.remove();
    },
  };
}
