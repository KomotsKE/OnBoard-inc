/**
 * Редактор: режим выбора элементов на сайте клиента.
 *
 * Грузится загрузчиком только по валидному токену сессии (ADR-0004) и
 * в обычном показе тура не участвует. Тур в этом режиме не запускается:
 * владелец ходит по своим страницам и выбирает элементы, подсказки ему
 * только мешали бы.
 */

import { guard, report } from "../core/guard";
import { startPicker } from "./picker";
import { createStep, readSession, type EditorState } from "./session";
import { selectorFor } from "./selector";
import { createEditorUi, type EditorUi } from "./ui";

export const EDITOR_VERSION = "0.1.0";

type EditorApi = {
  config?: { publicKey: string; apiUrl: string };
  /** Токен сессии: его кладёт загрузчик, прочитав `?onboard_edit`. */
  editor?: { token: string };
  stopEditor?: () => void;
};

let active: { stop: () => void } | null = null;

function globalApi(target: Window): EditorApi | null {
  const api = (target as unknown as Record<string, unknown>)["OnBoard"];
  return api ? (api as EditorApi) : null;
}

/** Подсветка и селектор под курсором; повторный расчёт на том же элементе не нужен. */
function trackHover(ui: EditorUi): (element: Element | null) => void {
  let last: Element | null = null;
  return (element) => {
    if (element === last) {
      return;
    }
    last = element;
    if (element === null) {
      ui.highlight(null);
      ui.showSelector(null);
      return;
    }
    ui.highlight(element.getBoundingClientRect());
    ui.showSelector(selectorFor(element));
  };
}

function run(target: Window, apiUrl: string, token: string, state: EditorState): void {
  const doc = target.document;
  let picked: string | null = null;

  const ui = createEditorUi(doc, state.tour, state.steps, {
    onAdd: (draft) => {
      if (picked === null) {
        return;
      }
      void createStep(apiUrl, token, { selector: picked, ...draft }).then((step) => {
        if (step === null) {
          ui.setStatus("Шаг не сохранился. Проверьте связь и попробуйте ещё раз.");
          return;
        }
        ui.addStep(step);
      });
    },
    onDone: () => stop(),
  });

  const hover = trackHover(ui);
  const stopPicker = startPicker(doc, ui.owns, {
    onHover: hover,
    onPick: (element) => {
      picked = selectorFor(element);
      if (picked === null) {
        ui.setStatus("Для этого элемента не удалось составить селектор");
        return;
      }
      ui.showSelector(picked);
      ui.openForm();
    },
  });

  active = {
    stop: () => {
      stopPicker();
      ui.stop();
    },
  };
}

export function stop(): void {
  active?.stop();
  active = null;
}

export async function start(target: Window = window): Promise<void> {
  try {
    const api = globalApi(target);
    const token = api?.editor?.token;
    const apiUrl = api?.config?.apiUrl;
    if (!api || !token || !apiUrl) {
      return;
    }

    const state = await readSession(apiUrl, token);
    if (state === null) {
      // Молча, но заметно: чужой сайт не наше место для сообщений об ошибках.
      console.debug("[OnBoard] сессия редактора недействительна — режим не запускается");
      return;
    }
    if (state.mode !== "edit") {
      // Предпросмотр тура — T5.6: там запускается ядро, а не пикер.
      console.debug("[OnBoard] режим предпросмотра появится в задаче T5.6");
      return;
    }

    stop();
    api.stopEditor = guard("unexpected", stop);
    run(target, apiUrl, token, state);
  } catch (error) {
    report("unexpected", error);
    stop();
  }
}

guard("unexpected", () => void start())();
