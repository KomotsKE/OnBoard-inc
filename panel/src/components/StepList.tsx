import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { Step } from "../api/tours";

/**
 * Список шагов с перетаскиванием.
 *
 * Клавиатурный сенсор включён не для галочки: тур собирают и те, кто не
 * пользуется мышью, а ручка перетаскивания — обычная кнопка, доступная
 * с Tab (§4.4 docs/vision.md про доступность виджета, то же правило и здесь).
 */
export function StepList({
  steps,
  selectedId,
  onSelect,
  onReorder,
}: {
  steps: Step[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const ids = steps.map((step) => step.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    ids.splice(to, 0, ...ids.splice(from, 1));
    onReorder(ids);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={steps.map((step) => step.id)} strategy={verticalListSortingStrategy}>
        <ol className="steps" data-testid="step-list">
          {steps.map((step, index) => (
            <SortableStep
              key={step.id}
              step={step}
              index={index}
              selected={step.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableStep({
  step,
  index,
  selected,
  onSelect,
}: {
  step: Step;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  });

  return (
    <li
      ref={setNodeRef}
      className={selected ? "steps__item steps__item--selected" : "steps__item"}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      data-testid="step-item"
    >
      <button
        type="button"
        className="steps__handle"
        aria-label={`Переместить шаг ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <button type="button" className="steps__title" onClick={() => onSelect(step.id)}>
        <span className="steps__number">{index + 1}</span>
        <span>{step.title || step.body.slice(0, 40) || "Без заголовка"}</span>
        <code>{step.selector}</code>
      </button>
    </li>
  );
}
