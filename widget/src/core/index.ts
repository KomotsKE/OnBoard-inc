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
import { createEngine, type EngineTour, resumeIndex } from "./engine";
import { guard, report } from "./guard";
import { createHost, type WidgetTheme } from "./host";
import { createOverlay } from "./overlay";
import { createProgressStore, openStorage } from "./progress";
import { createResolver } from "./resolver";
import { createTooltip, type Placement, type TooltipLabels } from "./tooltip";
import { createWatcher } from "./watcher";

export const CORE_VERSION = "0.1.0";

type Theme = WidgetConfig["project"]["theme"];

type CoreApi = {
  version: string;
  config?: { publicKey: string };
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
    const tour = boot?.tour as EngineTour | null | undefined;
    if (!boot || !tour || tour.steps.length === 0) {
      console.debug("[OnBoard] ядро загружено без тура — показывать нечего");
      return;
    }

    // Повторный запуск не должен оставить второй оверлей поверх первого.
    stop();

    const doc = target.document;
    const progress = createProgressStore(
      api?.config?.publicKey ?? "unknown",
      openStorage(target),
    );
    if (!progress.persistent) {
      // Тур покажется ещё раз — деградация, а не поломка (§3.3 docs/idea.md).
      report("storage_unavailable", "прогресс живёт до перезагрузки страницы");
    }

    const from = resumeIndex(tour, progress.read(tour.id));
    if (from === null) {
      console.debug("[OnBoard] тур уже пройден и показывается один раз");
      return;
    }

    const theme = themeOf(boot.project.theme);
    const resolver = createResolver(doc);
    const host = createHost(doc, theme);
    const overlay = createOverlay(host.root, theme);

    // Три ссылки друг на друга: наблюдатель пересчитывает текущий шаг движка,
    // кнопки подсказки ведут движок, движок показывает подсказку. Замыкания
    // создаются раньше, чем вызываются, поэтому порядок объявлений безопасен.
    const watcher = createWatcher(doc, () => {
      const target = engine.current();
      if (target) {
        overlay.draw(target);
        tooltip.reposition();
      }
    });

    const tooltip = createTooltip(host.root, labelsOf(boot.project.theme), {
      onNext: () => void engine.next(),
      onBack: () => void engine.back(),
      onSkip: () => engine.skip(),
    });

    const engine = createEngine(
      { ...tour, steps: tour.steps.map((step) => ({ ...step, placement: placementOf(step.placement) })) },
      {
        resolver,
        overlay,
        tooltip,
        watcher,
        progress,
        view: target,
        onFinish: (reason) => {
          // Тур закончился сам: убираем всё, что показывали.
          console.debug("[OnBoard] тур завершён:", reason);
          stop();
        },
      },
    );

    active = {
      stop: () => {
        engine.stop();
        watcher.stop();
        tooltip.stop();
        overlay.stop();
        resolver.stop();
        host.stop();
      },
    };

    await engine.start(from);
  } catch (error) {
    report("render_failed", error);
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
  // Публичная поверхность: её зовёт чужой код, поэтому она тоже в контуре.
  api.start = guard("unexpected", () => void start(target));
  api.stop = guard("unexpected", stop);
  void start(target);
}

guard("unexpected", install)();
