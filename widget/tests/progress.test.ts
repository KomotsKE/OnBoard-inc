// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { createProgressStore, keyFor, openStorage } from "../src/core/progress";

function memoryStorage(overrides: Partial<Storage> = {}): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
    ...overrides,
  } as Storage;
}

const KEY = "pk_00000000000000000000000000000001";

describe("ключ хранилища", () => {
  it("включает публичный ключ проекта", () => {
    // Иначе два наших клиента на поддоменах одного домена делили бы прогресс.
    expect(keyFor(KEY, "t-1")).toBe(`onboard.v1.${KEY}.tour.t-1`);
    expect(keyFor("pk_второй", "t-1")).not.toBe(keyFor(KEY, "t-1"));
  });
});

describe("чтение и запись", () => {
  it("возвращает сохранённый прогресс", () => {
    const store = createProgressStore(KEY, memoryStorage());

    store.write("t-1", { step: 2, done: false });

    expect(store.read("t-1")).toEqual({ step: 2, done: false });
  });

  it("до первой записи прогресса нет", () => {
    expect(createProgressStore(KEY, memoryStorage()).read("t-1")).toBeNull();
  });

  it("чужая запись под нашим ключом не ломает тур", () => {
    const storage = memoryStorage();
    storage.setItem(keyFor(KEY, "t-1"), "{сломано");

    expect(createProgressStore(KEY, storage).read("t-1")).toBeNull();
  });

  it("запись не того вида считается отсутствующей", () => {
    const storage = memoryStorage();
    storage.setItem(keyFor(KEY, "t-1"), JSON.stringify({ step: "второй" }));

    expect(createProgressStore(KEY, storage).read("t-1")).toBeNull();
  });
});

describe("недоступное хранилище", () => {
  it("определяется записью-пробой, а не обращением", () => {
    // В приватном режиме Safari хранилище читается, но запись выбрасывает.
    const view = {
      localStorage: memoryStorage({
        setItem: () => {
          throw new Error("квота 0");
        },
      }),
    } as unknown as Window;

    expect(openStorage(view)).toBeNull();
  });

  it("сам доступ к localStorage может выбросить исключение", () => {
    const view = {
      get localStorage(): Storage {
        throw new Error("данные сайтов отключены");
      },
    } as unknown as Window;

    expect(openStorage(view)).toBeNull();
  });

  it("без хранилища тур проходится, прогресс живёт в памяти", () => {
    const store = createProgressStore(KEY, null);

    store.write("t-1", { step: 1, done: false });

    // Деградация, а не поломка: тур покажется ещё раз (§3.3 docs/idea.md).
    expect(store.persistent).toBe(false);
    expect(store.read("t-1")).toEqual({ step: 1, done: false });
  });

  it("кончившаяся посреди тура квота не роняет запись", () => {
    const store = createProgressStore(
      KEY,
      memoryStorage({
        setItem: () => {
          throw new Error("квота кончилась");
        },
      }),
    );

    expect(() => store.write("t-1", { step: 1, done: false })).not.toThrow();
    expect(store.read("t-1")).toEqual({ step: 1, done: false });
  });
});
