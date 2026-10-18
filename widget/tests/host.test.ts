// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { createHost, type WidgetTheme } from "../src/core/host";

const THEME: WidgetTheme = {
  primaryColor: "#2563EB",
  textColor: "#0F172A",
  backdropOpacity: 0.55,
  borderRadius: "8px",
  fontFamily: 'system-ui, "Segoe UI", sans-serif',
};

function hostElement(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-onboard="host"]');
  if (!node) {
    throw new Error("хост не найден");
  }
  return node;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("хост виджета", () => {
  it("это один элемент в body с открытым shadow root", () => {
    const host = createHost(document, THEME);

    expect(hostElement().parentElement).toBe(document.body);
    expect(host.root).toBe(hostElement().shadowRoot);
  });

  it("не перехватывает события и стоит поверх чужих виджетов", () => {
    createHost(document, THEME);

    const style = hostElement().style;
    expect(style.pointerEvents).toBe("none");
    expect(style.position).toBe("fixed");
    // Столько же держат чужие виджеты — ADR-0002.
    expect(style.zIndex).toBe("2147483000");
  });

  it("не добавляет в документ клиента ни одного стиля", () => {
    createHost(document, THEME);

    // Следствие ADR-0002, проверяемое буквально: стили живут только в shadow root.
    expect(document.head.querySelectorAll("style, link")).toHaveLength(0);
    expect(document.body.querySelectorAll("style")).toHaveLength(0);
  });

  it("в окружении без adoptedStyleSheets кладёт стили в shadow root тегом", () => {
    // Именно эта ветка работает в Safari до 16.4 — и в jsdom, где и проверяется.
    const host = createHost(document, THEME);

    expect(host.root.querySelector("style")?.textContent).toContain(".tip");
  });

  it("пробрасывает тему переменными, не склеивая строку стиля", () => {
    createHost(document, {
      ...THEME,
      // Свободный текст из темы: склейка позволила бы подмешать своё свойство.
      fontFamily: 'Inter; position: static',
    });

    const style = hostElement().style;
    expect(style.getPropertyValue("--onboard-primary")).toBe("#2563EB");
    expect(style.position).toBe("fixed");
  });

  it("stop убирает хост со страницы", () => {
    const host = createHost(document, THEME);

    host.stop();

    expect(document.querySelector('[data-onboard="host"]')).toBeNull();
  });
});
