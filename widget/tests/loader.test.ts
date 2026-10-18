// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { alreadyInitialised, readConfig, start } from "../src/loader/index";

function scriptWith(attrs: Record<string, string>): HTMLScriptElement {
  const script = document.createElement("script");
  for (const [name, value] of Object.entries(attrs)) {
    script.setAttribute(name, value);
  }
  return script;
}

describe("чтение параметров тега", () => {
  it("берёт ключ и адрес API", () => {
    const config = readConfig(
      scriptWith({ "data-key": "pk_abc", "data-api": "https://api.example/" }),
    );

    // Завершающий слэш срезается: иначе получим https://api.example//v1/...
    expect(config).toEqual({ publicKey: "pk_abc", apiUrl: "https://api.example" });
  });

  it("не запускается без обязательных параметров", () => {
    expect(readConfig(scriptWith({ "data-key": "pk_abc" }))).toBeNull();
    expect(readConfig(scriptWith({ "data-api": "https://api.example" }))).toBeNull();
    expect(readConfig(null)).toBeNull();
  });

  it("игнорирует пробелы вокруг значений", () => {
    const config = readConfig(
      scriptWith({ "data-key": "  pk_abc  ", "data-api": "  https://api.example  " }),
    );

    expect(config?.publicKey).toBe("pk_abc");
  });
});

describe("защита от повторной вставки", () => {
  it("видит уже инициализированный виджет", () => {
    const target = { OnBoard: { version: "0.1.0" } } as unknown as Window;

    expect(alreadyInitialised(target)).toBe(true);
  });

  it("второй запуск ничего не делает", () => {
    const first = { version: "первый" };
    const target = { OnBoard: first, document: { currentScript: null } } as unknown as Window;

    start(target);

    expect((target as unknown as Record<string, unknown>).OnBoard).toBe(first);
  });

  it("не выбрасывает исключение, если окружение неожиданное", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    // Сайт клиента не должен падать из-за нас ни при каких входных данных.
    expect(() => start({} as unknown as Window)).not.toThrow();

    debug.mockRestore();
  });
});
