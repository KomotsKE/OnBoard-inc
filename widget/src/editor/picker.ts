/**
 * Выбор элемента на чужой странице: подсветка под курсором и перехват клика.
 *
 * Слушатели стоят в фазе перехвата и гасят клик: иначе выбор ссылки увёл бы
 * владельца со страницы, а выбор кнопки отправил бы форму сайта. Чужой DOM
 * при этом не меняется — подсветку рисует редактор у себя (инвариант №2).
 */

import { guard } from "../core/guard";

export type PickerHandlers = {
  /** Курсор над элементом страницы или ушёл с неё (`null`). */
  onHover: (element: Element | null) => void;
  onPick: (element: Element) => void;
};

function elementAt(event: Event): Element | null {
  const target = event.target;
  return target instanceof Element ? target : null;
}

export function startPicker(
  doc: Document,
  owns: (node: EventTarget | null) => boolean,
  handlers: PickerHandlers,
): () => void {
  const onMove = guard("unexpected", (event: MouseEvent) => {
    const element = elementAt(event);
    handlers.onHover(element !== null && !owns(element) ? element : null);
  });

  const onClick = guard("unexpected", (event: MouseEvent) => {
    const element = elementAt(event);
    if (element === null || owns(element)) {
      return;
    }
    // Сайт не должен узнать об этом клике: он выбирает элемент, а не нажимает.
    event.preventDefault();
    event.stopPropagation();
    handlers.onPick(element);
  });

  doc.addEventListener("mousemove", onMove, true);
  doc.addEventListener("click", onClick, true);

  return () => {
    doc.removeEventListener("mousemove", onMove, true);
    doc.removeEventListener("click", onClick, true);
  };
}
