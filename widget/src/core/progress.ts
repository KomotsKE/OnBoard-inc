/**
 * Прогресс тура у посетителя: на каком шаге остановился и пройден ли тур.
 *
 * Ключ включает публичный ключ проекта: два наших клиента на поддоменах одного
 * домена иначе делили бы хранилище и портили бы друг другу `show_once`
 * (§6 docs/vision.md).
 *
 * Хранилище может быть недоступно — приватный режим, отключённые данные сайтов,
 * ограничения Safari на script-writable storage. Тогда прогресс живёт в памяти
 * страницы: тур покажется ещё раз, но будет работать. Деградация, а не поломка
 * (§3.3 docs/idea.md).
 */

export type TourProgress = {
  /** Шаг, на котором посетитель находится. */
  step: number;
  /** Тур доведён до конца или пропущен. */
  done: boolean;
};

export type ProgressStore = {
  read: (tourId: string) => TourProgress | null;
  write: (tourId: string, progress: TourProgress) => void;
  /** Доступно ли настоящее хранилище — об этом говорит событие `storage_unavailable`. */
  persistent: boolean;
};

const PREFIX = "onboard.v1";

export function keyFor(publicKey: string, tourId: string): string {
  return `${PREFIX}.${publicKey}.tour.${tourId}`;
}

/**
 * Запись-проба, а не просто обращение к localStorage: в приватном режиме
 * Safari хранилище существует и читается, но запись в него выбрасывает
 * исключение из-за нулевой квоты.
 */
export function openStorage(view: Window): Storage | null {
  try {
    const storage = view.localStorage;
    const probe = `${PREFIX}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): TourProgress | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<TourProgress>;
    if (typeof value.step !== "number" || typeof value.done !== "boolean") {
      return null;
    }
    return { step: value.step, done: value.done };
  } catch {
    // Чужая запись под нашим ключом или обрезанные данные — начинаем сначала.
    return null;
  }
}

export function createProgressStore(publicKey: string, storage: Storage | null): ProgressStore {
  const memory = new Map<string, string>();

  function get(key: string): string | null {
    if (storage) {
      try {
        const stored = storage.getItem(key);
        if (stored !== null) {
          return stored;
        }
      } catch {
        // Хранилище перестало отвечать посреди тура — дальше читаем из памяти.
      }
    }
    // Память — не только запасной путь при отсутствии хранилища: сюда же
    // попадает запись, которую хранилище отказалось принять по квоте.
    return memory.get(key) ?? null;
  }

  function set(key: string, value: string): void {
    if (!storage) {
      memory.set(key, value);
      return;
    }
    try {
      storage.setItem(key, value);
    } catch {
      // Квота кончилась посреди тура — не повод его ронять.
      memory.set(key, value);
    }
  }

  return {
    read: (tourId) => parse(get(keyFor(publicKey, tourId))),
    write: (tourId, progress) => set(keyFor(publicKey, tourId), JSON.stringify(progress)),
    persistent: storage !== null,
  };
}
