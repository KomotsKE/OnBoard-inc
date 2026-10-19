import { useEffect, useState } from "react";

import type { Step, StepDraft } from "../api/tours";

/**
 * Форма шага — контролируемая, с явной кнопкой сохранения.
 *
 * Автосохранение на каждый символ дало бы запрос на каждое нажатие клавиши
 * (§4.6 docs/vision.md). Пока есть несохранённые правки, это видно по кнопке.
 */

const PLACEMENTS: { value: Step["placement"]; label: string }[] = [
  { value: "auto", label: "Автоматически" },
  { value: "top", label: "Сверху" },
  { value: "bottom", label: "Снизу" },
  { value: "left", label: "Слева" },
  { value: "right", label: "Справа" },
];

const BODY_MAX = 500;
const TITLE_MAX = 80;
const SELECTOR_MAX = 500;

export function StepForm({
  step,
  saving,
  onSave,
  onDelete,
}: {
  step: Step;
  saving: boolean;
  onSave: (patch: StepDraft) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<StepDraft>(toDraft(step));

  // Выбрали другой шаг — форма показывает его, а не прежние правки.
  useEffect(() => setDraft(toDraft(step)), [step]);

  const changed = JSON.stringify(draft) !== JSON.stringify(toDraft(step));

  return (
    <form
      className="step-form"
      data-testid="step-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <label htmlFor="step-selector">CSS-селектор элемента</label>
      <input
        id="step-selector"
        value={draft.selector}
        maxLength={SELECTOR_MAX}
        onChange={(event) => setDraft({ ...draft, selector: event.target.value })}
      />
      <p className="install__hint">
        Например <code>[data-testid=&quot;filters&quot;]</code>. Устойчивее всего атрибуты
        и идентификаторы: классы вида <code>css-1q2w3e</code> меняются при каждой сборке
        сайта.
      </p>

      <label htmlFor="step-title">Заголовок</label>
      <input
        id="step-title"
        value={draft.title}
        maxLength={TITLE_MAX}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
      />

      <label htmlFor="step-body">Текст подсказки</label>
      <textarea
        id="step-body"
        rows={3}
        value={draft.body}
        maxLength={BODY_MAX}
        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
      />

      <label htmlFor="step-placement">Где показать подсказку</label>
      <select
        id="step-placement"
        value={draft.placement}
        onChange={(event) =>
          setDraft({ ...draft, placement: event.target.value as Step["placement"] })
        }
      >
        {PLACEMENTS.map((placement) => (
          <option key={placement.value} value={placement.value}>
            {placement.label}
          </option>
        ))}
      </select>

      <div className="projects__new-row step-form__actions">
        <button type="submit" disabled={!changed || saving || !draft.selector || !draft.body}>
          {saving ? "Сохраняем…" : changed ? "Сохранить" : "Сохранено"}
        </button>
        <button type="button" className="projects__delete" onClick={onDelete}>
          Удалить шаг
        </button>
      </div>
    </form>
  );
}

function toDraft(step: Step): StepDraft {
  return {
    selector: step.selector,
    title: step.title,
    body: step.body,
    placement: step.placement,
  };
}
