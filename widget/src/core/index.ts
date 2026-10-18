/**
 * Ядро: движок тура. Подгружается загрузчиком только когда для текущего URL
 * есть опубликованный тур (ADR-0001), поэтому его размер не влияет на
 * страницы, где показывать нечего.
 *
 * Сейчас ядро умеет первый шаг: найти цель и подсветить её. Подсказка, переходы
 * между шагами и события — T2.4–T2.8; `start` и `stop` на `window.OnBoard` —
 * это обещанная публичная поверхность виджета (§6 docs/conventions.md), и
 * e2e пользуется именно ею, а не внутренностями.
 */

// Тип описан один раз — в загрузчике, который этот конфиг и получает. Импорт
// только типов: в бандл ядра код загрузчика не попадает.
import type { WidgetConfig } from "../loader/index";
import { createOverlay, type Overlay, type OverlayTheme } from "./overlay";
import { createResolver, type Resolver } from "./resolver";

export const CORE_VERSION = "0.1.0";

type CoreApi = {
  version: string;
  boot?: WidgetConfig;
  start?: () => void;
  stop?: () => void;
};

let active: { resolver: Resolver; overlay: Overlay } | null = null;

function globalApi(target: Window): CoreApi | undefined {
  return (target as unknown as Record<string, CoreApi | undefined>).OnBoard;
}

function themeOf(theme: WidgetConfig["project"]["theme"]): OverlayTheme {
  // Бэкенд отдаёт тему целиком (projects.create пишет её полностью), поэтому
  // значения здесь — страховка от испорченного ответа, а не вторая копия
  // значений по умолчанию: исключение на чужом сайте недопустимо.
  return {
    primaryColor: String(theme.primary_color ?? "#2563EB"),
    backdropOpacity: Number(theme.backdrop_opacity ?? 0.55),
    borderRadius: String(theme.border_radius ?? "8px"),
  };
}

export function stop(): void {
  active?.resolver.stop();
  active?.overlay.stop();
  active = null;
}

export async function start(target: Window = window): Promise<void> {
  try {
    const api = globalApi(target);
    const boot = api?.boot;
    const step = boot?.tour?.steps[0];
    if (!boot || !step) {
      console.debug("[OnBoard] ядро загружено без тура — показывать нечего");
      return;
    }

    // Повторный запуск не должен оставить второй оверлей поверх первого.
    stop();

    const resolver = createResolver(target.document);
    const overlay = createOverlay(target.document, themeOf(boot.project.theme));
    active = { resolver, overlay };

    const resolution = await resolver.resolve(step.selector);
    if (resolution.status === "found") {
      overlay.highlight(resolution.element);
      return;
    }

    // Событие `step_target_missing` с этой причиной отправит движок (T2.5, T4.1):
    // сейчас отправлять некуда, а молча оставить затемнение без выреза нельзя.
    console.debug("[OnBoard] цель первого шага не найдена:", resolution.reason);
    stop();
  } catch (error) {
    console.debug("[OnBoard] ядро остановлено", error);
    stop();
  }
}

function install(target: Window = window): void {
  const api = globalApi(target);
  if (!api) {
    // Ядро без загрузчика: на чужой странице такого не бывает, но падать здесь
    // нельзя ни при каких входных данных (инвариант №1).
    return;
  }
  api.start = () => void start(target);
  api.stop = stop;
  void start(target);
}

install();
