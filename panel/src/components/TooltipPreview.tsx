import type { CSSProperties } from "react";

import type { Project } from "../api/projects";
import type { Step } from "../api/tours";

/**
 * Превью подсказки.
 *
 * Значения темы подставляются в те же CSS-переменные, которыми пользуется
 * виджет (`--onboard-primary`, `--onboard-radius`, …). Это не косметика:
 * разойдясь, превью начнёт врать о том, как подсказка выглядит на сайте
 * клиента (§4.6 docs/vision.md).
 */

export type PreviewStep = Pick<Step, "title" | "body">;

export function TooltipPreview({
  step,
  index,
  total,
  theme,
}: {
  step: PreviewStep;
  index: number;
  total: number;
  theme: Project["theme"];
}) {
  const last = index + 1 === total;

  return (
    <div className="preview" data-testid="preview">
      <p className="preview__caption">Так шаг увидит посетитель</p>
      <div className="preview__tip" style={themeVariables(theme)}>
        <span className="preview__dots">
          {Array.from({ length: total }, (_, position) => (
            <span
              key={position}
              className="preview__dot"
              data-current={position === index ? "" : undefined}
            />
          ))}
        </span>
        {step.title ? <p className="preview__title">{step.title}</p> : null}
        <p className="preview__body">{step.body}</p>
        <div className="preview__footer">
          <span className="preview__ghost">{String(theme.skip_label ?? "Пропустить")}</span>
          <span className="preview__primary">
            {last ? String(theme.done_label ?? "Готово") : String(theme.next_label ?? "Далее")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Те же имена переменных, что в shadow root виджета. */
export function themeVariables(theme: Project["theme"]): CSSProperties {
  return {
    "--onboard-primary": String(theme.primary_color ?? "#2563EB"),
    "--onboard-text": String(theme.text_color ?? "#0F172A"),
    "--onboard-radius": String(theme.border_radius ?? "8px"),
    "--onboard-font": String(theme.font_family ?? "system-ui, sans-serif"),
  } as CSSProperties;
}
