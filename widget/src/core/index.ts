/**
 * Ядро: движок тура. Подгружается загрузчиком только когда для текущего URL
 * есть опубликованный тур (ADR-0001), поэтому его размер не влияет на
 * страницы, где показывать нечего.
 *
 * Сейчас ядро показывает первый шаг: находит цель, подсвечивает её и выводит
 * подсказку. Переходы между шагами, прогресс и события — T2.5–T2.8.
 * `start` и `stop` на `window.OnBoard` — обещанная публичная поверхность
 * виджета (§6 docs/conventions.md), и e2e пользуется именно ею.
 */

// Тип описан один раз — в загрузчике, который этот конфиг и получает. Импорт
// только типов: в бандл ядра код загрузчика не попадает.
import type { WidgetConfig } from "../loader/index";
import { createHost, type WidgetTheme } from "./host";
import { createOverlay } from "./overlay";
import { createResolver } from "./resolver";
import { createTooltip, type Placement, type TooltipLabels } from "./tooltip";
import { createWatcher } from "./watcher";

export const CORE_VERSION = "0.1.0";

type Theme = WidgetConfig["project"]["theme"];

type CoreApi = {
  version: string;
  boot?: WidgetConfig;
  start?: () => void;
  stop?: () => void;
};

const SIDES = ["top", "bottom", "left", "right"];

let active: { stop: () => void } | null = null;

function globalApi(target: Window): CoreApi | undefined {
  return (target as unknown as Record<string, CoreApi | undefined>).OnBoard;
}

// Бэкенд отдаёт тему целиком (projects.create пишет её полностью), поэтому
// значения ниже — страховка от испорченного ответа, а не вторая копия значений
// по умолчанию: исключение на чужом сайте недопустимо.
function themeOf(theme: Theme): WidgetTheme {
  return {
    primaryColor: String(theme.primary_color ?? "#2563EB"),
    textColor: String(theme.text_color ?? "#0F172A"),
    backdropOpacity: Number(theme.backdrop_opacity ?? 0.55),
    borderRadius: String(theme.border_radius ?? "8px"),
    fontFamily: String(theme.font_family ?? "system-ui, sans-serif"),
  };
}

function labelsOf(theme: Theme): TooltipLabels {
  return {
    next: String(theme.next_label ?? "Далее"),
    skip: String(theme.skip_label ?? "Пропустить"),
    done: String(theme.done_label ?? "Готово"),
  };
}

function placementOf(value: string): Placement {
  return SIDES.includes(value) ? (value as Placement) : "auto";
}

export function stop(): void {
  active?.stop();
  active = null;
}

export async function start(target: Window = window): Promise<void> {
  try {
    const api = globalApi(target);
    const boot = api?.boot;
    const tour = boot?.tour;
    const step = tour?.steps[0];
    if (!boot || !tour || !step) {
      console.debug("[OnBoard] ядро загружено без тура — показывать нечего");
      return;
    }

    // Повторный запуск не должен оставить второй оверлей поверх первого.
    stop();

    const doc = target.document;
    const theme = themeOf(boot.project.theme);
    const resolver = createResolver(doc);
    const host = createHost(doc, theme);
    const overlay = createOverlay(host.root, theme);
    const tooltip = createTooltip(host.root, labelsOf(boot.project.theme), {
      onSkip: () => stop(),
      // Переходы между шагами — T2.5. Кнопка уже на месте, потому что от неё
      // зависит раскладка подсказки, которую проверяет e2e.
      onNext: () => console.debug("[OnBoard] переход к следующему шагу — T2.5"),
    });

    let current: Element | null = null;
    const watcher = createWatcher(doc, () => {
      if (current) {
        overlay.draw(current);
        tooltip.reposition();
      }
    });

    active = {
      stop: () => {
        watcher.stop();
        tooltip.stop();
        overlay.stop();
        resolver.stop();
        host.stop();
      },
    };

    const resolution = await resolver.resolve(step.selector);
    if (resolution.status === "found") {
      current = resolution.element;
      overlay.draw(current);
      tooltip.show(
        { title: step.title, body: step.body, placement: placementOf(step.placement) },
        current,
        { index: 0, total: tour.steps.length },
      );
      watcher.watch(current);
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
