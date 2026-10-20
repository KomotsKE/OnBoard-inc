// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { editorToken } from "../src/loader/index";
import { startPicker } from "../src/editor/picker";
import { createEditorUi } from "../src/editor/ui";

afterEach(() => {
  document.body.innerHTML = "";
});

function ui(steps: Parameters<typeof createEditorUi>[2] = [], handlers = {}) {
  return createEditorUi(
    document,
    { name: "Знакомство" },
    steps,
    { onAdd: vi.fn(), onDone: vi.fn(), ...handlers },
  );
}

function part(name: string): HTMLElement {
  const root = document.querySelector('[data-onboard="editor"]')?.shadowRoot;
  const element = root?.querySelector(`[data-part="${name}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`в панели нет части ${name}`);
  }
  return element;
}

describe("токен режима редактора в адресе", () => {
  it.each([
    ["?onboard_edit=abc", "abc"],
    ["?tab=5&onboard_edit=abc", "abc"],
    ["?onboard_edit=", null],
    ["?onboard_edit=%20", null],
    ["?tab=5", null],
    ["", null],
    // Целый адрес: токен ищется и в записи навигации, когда SPA уже переписало location.
    ["http://сайт/отчёты?onboard_edit=abc", "abc"],
    ["http://сайт/отчёты", null],
  ])("%s → %s", (search, expected) => {
    expect(editorToken(search)).toBe(expected);
  });
});

describe("пикер", () => {
  it("гасит клик по сайту и сообщает выбранный элемент", () => {
    document.body.innerHTML = `<a href="/уйти" id="ссылка">Уйти</a>`;
    const link = document.getElementById("ссылка")!;
    const onPick = vi.fn();
    const stop = startPicker(document, () => false, { onHover: vi.fn(), onPick });

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    // Клик по ссылке на чужом сайте обязан остаться без последствий.
    expect(event.defaultPrevented).toBe(true);
    expect(onPick).toHaveBeenCalledWith(link);
    stop();
  });

  it("не трогает клики по собственной панели", () => {
    document.body.innerHTML = `<button id="свой">Готово</button>`;
    const own = document.getElementById("свой")!;
    const onPick = vi.fn();
    const stop = startPicker(document, (node) => node === own, { onHover: vi.fn(), onPick });

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    own.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
    stop();
  });

  it("после остановки слушателей не остаётся", () => {
    document.body.innerHTML = `<button id="цель">Цель</button>`;
    const onPick = vi.fn();
    const stop = startPicker(document, () => false, { onHover: vi.fn(), onPick });

    stop();
    document.getElementById("цель")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("панель редактора", () => {
  it("живёт в своём shadow root и не добавляет стилей в документ", () => {
    const editor = ui();

    expect(document.querySelectorAll("style")).toHaveLength(0);
    expect(document.querySelector('[data-onboard="editor"]')?.shadowRoot).toBeTruthy();
    editor.stop();
  });

  it("показывает уже существующие шаги", () => {
    const editor = ui([
      { id: "1", position: 0, selector: "#a", title: "Фильтры", body: "Здесь", placement: "auto" },
    ]);

    expect(part("steps").textContent).toContain("Фильтры — Здесь");
    editor.stop();
  });

  it("текст шага ставится как текст, а не как разметка", () => {
    const editor = ui();

    editor.addStep({
      id: "2",
      position: 1,
      selector: "#b",
      title: "",
      body: "<img src=x onerror=alert(1)>",
      placement: "auto",
    });

    // Инвариант №6: пользовательский текст никогда не становится разметкой.
    expect(part("steps").querySelector("img")).toBeNull();
    expect(part("steps").textContent).toContain("<img src=x");
    editor.stop();
  });

  it("не отправляет шаг без текста подсказки", () => {
    const onAdd = vi.fn();
    const editor = ui([], { onAdd });

    part("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(onAdd).not.toHaveBeenCalled();
    expect(part("status").textContent).toContain("Текст подсказки обязателен");
    editor.stop();
  });

  it("отдаёт заголовок и текст, когда форма заполнена", () => {
    const onAdd = vi.fn();
    const editor = ui([], { onAdd });
    (part("step-title") as HTMLInputElement).value = "  Экспорт  ";
    (part("step-body") as HTMLTextAreaElement).value = "  Выгрузка отчёта  ";

    part("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(onAdd).toHaveBeenCalledWith({ title: "Экспорт", body: "Выгрузка отчёта" });
    editor.stop();
  });

  it("убирает за собой всё при выходе", () => {
    const editor = ui();

    editor.stop();

    expect(document.querySelector('[data-onboard="editor"]')).toBeNull();
  });
});
