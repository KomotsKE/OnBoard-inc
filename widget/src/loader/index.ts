/**
 * Загрузчик: всё, что исполняется на чужой странице сразу.
 *
 * Здесь живёт только то, что обязано работать до любых решений: защита от
 * повторной вставки и чтение параметров тега. Запрос конфига и ленивая загрузка
 * ядра — T2.1; логика тура в загрузчике не появится никогда, потому что он
 * обновляется у клиентов медленнее ядра (ADR-0009).
 *
 * Каждая точка входа обёрнута в try/catch: исключение нашего кода на чужом
 * сайте — инцидент у клиента (инвариант №1).
 */

const GLOBAL = "OnBoard";
const VERSION = "0.1.0";

export type LoaderConfig = {
  publicKey: string;
  apiUrl: string;
};

/** Параметры берутся с тега, который вставил клиент: `data-key` и `data-api`. */
export function readConfig(script: HTMLScriptElement | null): LoaderConfig | null {
  const publicKey = script?.dataset.key?.trim();
  const apiUrl = script?.dataset.api?.trim();
  if (!publicKey || !apiUrl) {
    return null;
  }
  return { publicKey, apiUrl: apiUrl.replace(/\/+$/, "") };
}

export function alreadyInitialised(target: Window): boolean {
  return Boolean((target as unknown as Record<string, unknown>)[GLOBAL]);
}

export function start(target: Window = window): void {
  try {
    // Сниппет вполне могут вставить дважды — в шаблон страницы и в шаблон
    // лэйаута. Два оверлея поверх одного элемента ломают сайт клиента.
    if (alreadyInitialised(target)) {
      return;
    }

    const script = target.document.currentScript as HTMLScriptElement | null;
    const config = readConfig(script);
    if (!config) {
      console.debug("[OnBoard] нет data-key или data-api — виджет не запускается");
      return;
    }

    (target as unknown as Record<string, unknown>)[GLOBAL] = { version: VERSION, config };
  } catch (error) {
    console.debug("[OnBoard] загрузчик остановлен", error);
  }
}

start();
