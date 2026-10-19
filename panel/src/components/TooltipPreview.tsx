import type { Step } from "../api/tours";

/**
 * Превью подсказки.
 *
 * Использует те же имена CSS-переменных, что и виджет (`--onboard-primary`,
 * `--onboard-radius`, …). Это не косметика: разойдясь, превью начнёт врать
 * о том, как подсказка выглядит на сайте клиента (§4.6 docs/vision.md).
 */
export function TooltipPreview({ step, index, total }: { step: Step; index: number; total: number }) {
  return (
    <div className="preview" data-testid="preview">
      <p className="preview__caption">Так шаг увидит посетитель</p>
      <div className="preview__tip">
        {step.title ? <p className="preview__title">{step.title}</p> : null}
        <p className="preview__body">{step.body}</p>
        <div className="preview__footer">
          <span className="preview__dots">
            {Array.from({ length: total }, (_, position) => (
              <span
                key={position}
                className="preview__dot"
                data-current={position === index ? "" : undefined}
              />
            ))}
          </span>
          <span className="preview__ghost">Пропустить</span>
          <span className="preview__primary">{index + 1 === total ? "Готово" : "Далее"}</span>
        </div>
      </div>
    </div>
  );
}
