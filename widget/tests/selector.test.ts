// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { selectorFor } from "../src/editor/selector";

/**
 * Проверяется не форма селектора, а его работа: найденный селектор обязан
 * указывать ровно на тот элемент, по которому кликнули. Привязка к точному
 * тексту селектора сделала бы тесты ложно-красными при любом улучшении
 * генератора.
 */
function pinpoints(element: Element): string {
  const selector = selectorFor(element);
  expect(selector, "селектор не сгенерирован").not.toBeNull();
  expect(document.querySelectorAll(selector!), `селектор не единственный: ${selector}`).toHaveLength(
    1,
  );
  expect(document.querySelector(selector!), `селектор указывает не туда: ${selector}`).toBe(
    element,
  );
  return selector!;
}

function markup(html: string): void {
  document.body.innerHTML = html;
}

function target(): Element {
  const element = document.querySelector("[data-цель]");
  if (element === null) {
    throw new Error("в разметке теста нет элемента с data-цель");
  }
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("приоритет атрибутов", () => {
  it.each(["data-testid", "data-qa", "data-test", "data-onboard-id"])(
    "%s выигрывает у всего остального",
    (attribute) => {
      markup(`<button id="export" class="btn" ${attribute}="экспорт" data-цель>Выгрузить</button>`);

      expect(pinpoints(target())).toBe(`[${attribute}="экспорт"]`);
    },
  );

  it("осмысленный id берётся, когда data-атрибутов нет", () => {
    markup(`<button id="export-report" class="btn primary" data-цель>Выгрузить</button>`);

    expect(pinpoints(target())).toBe("#export-report");
  });

  it("тег с aria-label идёт после id, но раньше классов", () => {
    markup(`<button class="btn" aria-label="Выгрузить отчёт" data-цель></button>`);

    expect(pinpoints(target())).toBe('button[aria-label="Выгрузить отчёт"]');
  });

  it("name и role тоже годятся", () => {
    markup(`
      <input name="период" data-цель>
      <div role="навигация"></div>
    `);

    expect(pinpoints(target())).toBe('input[name="период"]');
  });
});

describe("машинные имена отбрасываются", () => {
  it("сгенерированный id не используется", () => {
    markup(`<main><button id="__next_a1b2" class="кнопка" data-цель>Выгрузить</button></main>`);

    const selector = pinpoints(target());

    expect(selector).not.toContain("__next_a1b2");
  });

  it("id с двоеточиями от radix не используется", () => {
    markup(`<main><button id="radix:r3:" class="кнопка" data-цель>Выгрузить</button></main>`);

    const selector = pinpoints(target());

    expect(selector).not.toContain("radix");
  });

  it("классы CSS-модулей и emotion не используются", () => {
    markup(`
      <main>
        <button class="css-1q2w3e _btn_a1b2 кнопка-выгрузки" data-цель>Выгрузить</button>
      </main>
    `);

    const selector = pinpoints(target());

    expect(selector).toContain("кнопка-выгрузки");
    expect(selector).not.toContain("css-1q2w3e");
    expect(selector).not.toContain("_btn_a1b2");
  });

  it("элемент только с машинными классами всё равно находится", () => {
    markup(`
      <main>
        <section class="css-9z8y7x">
          <button class="_btn_a1b2" data-цель>Выгрузить</button>
        </section>
      </main>
    `);

    const selector = pinpoints(target());

    expect(selector).not.toContain("_btn_a1b2");
  });
});

describe("когда зацепиться не за что", () => {
  it("глубокая вложенность без атрибутов различается по позиции", () => {
    markup(`
      <main>
        <section><div><ul>
          <li><span>Первый</span></li>
          <li><span data-цель>Второй</span></li>
          <li><span>Третий</span></li>
        </ul></div></section>
      </main>
    `);

    expect(pinpoints(target())).toContain(":nth-of-type(");
  });

  it("путь строится от ближайшего устойчивого предка, а не от body", () => {
    markup(`
      <main>
        <section data-testid="панель">
          <div><button data-цель>Выгрузить</button></div>
        </section>
      </main>
    `);

    expect(pinpoints(target())).toMatch(/^\[data-testid="панель"\]/);
  });

  it("две одинаковые кнопки подряд различаются", () => {
    markup(`
      <main><div>
        <button class="btn">Выгрузить</button>
        <button class="btn" data-цель>Выгрузить</button>
      </div></main>
    `);

    expect(pinpoints(target())).toContain(":nth-of-type(2)");
  });

  it("повторяющийся id не обманывает генератор", () => {
    // Дубликаты id в реальной разметке встречаются и ломают поиск по #id.
    markup(`
      <main><div>
        <button id="кнопка">Первая</button>
        <button id="кнопка" data-цель>Вторая</button>
      </div></main>
    `);

    expect(pinpoints(target())).toContain(":nth-of-type(2)");
  });

  it("кавычки и обратный слэш в значении не ломают селектор", () => {
    markup(`<button aria-label='кнопка "Выгрузить"' data-цель></button>`);

    pinpoints(target());
  });
});

describe("границы", () => {
  it("элемент вне документа селектора не получает", () => {
    expect(selectorFor(document.createElement("button"))).toBeNull();
  });

  it("сам body не ищется по пути", () => {
    expect(selectorFor(document.body)).toBe("body");
  });
});
