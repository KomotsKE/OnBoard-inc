import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { StepDraft, UrlMatch } from "../api/tours";
import { Empty, ErrorState, Loading } from "../components/States";
import { StepForm } from "../components/StepForm";
import { useProject } from "../hooks/useProjects";
import { StepList } from "../components/StepList";
import { TooltipPreview } from "../components/TooltipPreview";
import {
  useCreateStep,
  useDeleteStep,
  useEditorSession,
  useRefreshOnFocus,
  useReorderSteps,
  useTour,
  useUpdateStep,
  useUpdateTour,
} from "../hooks/useTour";
import { useTourPublication } from "../hooks/useTours";
import { plural } from "../text";

/** S8 docs/screens.md — конструктор тура: шаги, их порядок и условие показа. */
export function TourBuilderPage() {
  const { projectId = "", tourId = "" } = useParams();
  const tour = useTour(tourId);
  const project = useProject(projectId);
  const createStep = useCreateStep(tourId, projectId);
  const updateStep = useUpdateStep(tourId, projectId);
  const deleteStep = useDeleteStep(tourId, projectId);
  const reorder = useReorderSteps(tourId, projectId);
  const publication = useTourPublication(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Шаги могут появиться в соседней вкладке, в режиме выбора на сайте (T5.5).
  useRefreshOnFocus(tourId);

  if (tour.isPending) {
    return <Loading what="тур" />;
  }
  if (tour.isError) {
    return <ErrorState what="тур" onRetry={() => void tour.refetch()} />;
  }

  const steps = tour.data.steps;
  const selected = steps.find((step) => step.id === selectedId) ?? steps[0] ?? null;
  const published = tour.data.status === "published";

  return (
    <section className="builder">
      <p>
        <Link to={`/projects/${projectId}/tours`}>← К списку туров</Link>
      </p>
      <h1>{tour.data.name}</h1>
      <p>
        <span className={published ? "tours__badge tours__badge--live" : "tours__badge"}>
          {published ? "Опубликован" : "Черновик"}
        </span>{" "}
        · {plural(steps.length, ["шаг", "шага", "шагов"])}{" "}
        <button
          type="button"
          disabled={publication.isPending || (!published && steps.length === 0)}
          onClick={() => publication.mutate({ id: tourId, published: !published })}
        >
          {published ? "Снять с публикации" : "Опубликовать"}
        </button>
      </p>

      <Settings tourId={tourId} projectId={projectId} match={tour.data.url_match} showOnce={tour.data.show_once} />

      <div className="builder__columns">
        <div>
          <h2>Шаги</h2>
          {steps.length === 0 ? (
            <Empty testId="steps-empty">
              Шагов пока нет. Добавьте первый — укажите селектор элемента и текст подсказки.
            </Empty>
          ) : (
            <StepList
              steps={steps}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onReorder={(ids) => reorder.mutate(ids)}
            />
          )}
          {reorder.isError ? (
            <p role="alert" data-testid="reorder-error">
              Не удалось сохранить порядок — вернули как было.
            </p>
          ) : null}
          <PickOnSite tourId={tourId} origins={project.data?.allowed_origins ?? []} />
          <AddStep
            pending={createStep.isPending}
            failed={createStep.isError}
            onAdd={(draft) =>
              createStep.mutate(draft, { onSuccess: (step) => setSelectedId(step.id) })
            }
          />
        </div>

        <div>
          {selected ? (
            <>
              <h2>Шаг {steps.indexOf(selected) + 1}</h2>
              <StepForm
                key={selected.id}
                step={selected}
                saving={updateStep.isPending}
                onSave={(patch) => updateStep.mutate({ id: selected.id, patch })}
                onDelete={() => {
                  deleteStep.mutate(selected.id);
                  setSelectedId(null);
                }}
              />
              {updateStep.isError ? (
                <p role="alert" data-testid="step-error">
                  Не удалось сохранить шаг. Проверьте селектор и текст.
                </p>
              ) : null}
              {project.data ? (
                // Превью рисуется темой проекта, а не токенами панели:
                // иначе оно показывает не то, что увидит посетитель.
                <TooltipPreview
                  step={selected}
                  index={steps.indexOf(selected)}
                  total={steps.length}
                  theme={project.data.theme}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Адрес по умолчанию: первый разрешённый домен, дальше владелец правит путь. */
export function defaultPageUrl(origins: string[]): string {
  return origins.length > 0 ? `${origins[0]}/` : "";
}

/**
 * Выход в режим выбора элементов на сайте клиента (ADR-0004).
 *
 * Адрес страницы спрашиваем: в проекте хранятся разрешённые домены, а не
 * страницы, и угадать нужную нельзя. Вкладка открывается сразу по нажатию,
 * до запроса: открытая из ответа сервера, она была бы заблокирована браузером
 * как всплывающее окно без действия пользователя.
 */
function PickOnSite({ tourId, origins }: { tourId: string; origins: string[] }) {
  const session = useEditorSession(tourId);
  const [pageUrl, setPageUrl] = useState(defaultPageUrl(origins));

  if (origins.length === 0) {
    return (
      <p className="install__hint" data-testid="pick-no-origins">
        Чтобы выбирать элементы прямо на сайте, добавьте его домен на экране «Установка».
      </p>
    );
  }

  return (
    <form
      className="projects__new"
      data-testid="pick-on-site"
      onSubmit={(event) => {
        event.preventDefault();
        const tab = window.open("about:blank", "_blank");
        session.mutate(pageUrl.trim(), {
          onSuccess: ({ url }) => {
            if (!tab) {
              return;
            }
            // Чужая страница не должна иметь ссылки на вкладку панели.
            tab.opener = null;
            tab.location.replace(url);
          },
          onError: () => tab?.close(),
        });
      }}
    >
      <label htmlFor="page-url">Страница сайта, на которой выбирать элементы</label>
      <div className="projects__new-row">
        <input
          id="page-url"
          value={pageUrl}
          maxLength={2000}
          onChange={(event) => setPageUrl(event.target.value)}
        />
        <button type="submit" disabled={session.isPending || !pageUrl.trim()}>
          {session.isPending ? "Открываем…" : "Выбрать на сайте"}
        </button>
      </div>
      <p className="install__hint">
        Откроется в новой вкладке на 15 минут. Шаги, добавленные там, появятся здесь,
        когда вернётесь.
      </p>
      {session.isError ? (
        <p role="alert" data-testid="pick-error">
          Не удалось открыть режим выбора. Домен этой страницы должен быть в списке
          разрешённых на экране «Установка».
        </p>
      ) : null}
    </form>
  );
}

/**
 * Добавление шага — форма, а не кнопка.
 *
 * Селектор и текст обязательны на сервере, и шаг без них просто не создастся
 * (422). Кнопка «добавить» с заготовкой вроде `body` создавала бы шаг, который
 * подсвечивает всю страницу, — хуже, чем два поля.
 */
function AddStep({
  pending,
  failed,
  onAdd,
}: {
  pending: boolean;
  failed: boolean;
  onAdd: (draft: StepDraft) => void;
}) {
  const [selector, setSelector] = useState("");
  const [body, setBody] = useState("");

  return (
    <form
      className="projects__new"
      data-testid="add-step"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd({ selector: selector.trim(), title: "", body: body.trim(), placement: "auto" });
        setSelector("");
        setBody("");
      }}
    >
      <label htmlFor="new-selector">Новый шаг: селектор и текст</label>
      <div className="projects__new-row">
        <input
          id="new-selector"
          value={selector}
          placeholder='[data-testid="кнопка"]'
          onChange={(event) => setSelector(event.target.value)}
        />
        <input
          aria-label="Текст нового шага"
          value={body}
          placeholder="Что здесь происходит"
          onChange={(event) => setBody(event.target.value)}
        />
        <button type="submit" disabled={pending || !selector.trim() || !body.trim()}>
          Добавить шаг
        </button>
      </div>
      {failed ? <p role="alert">Не удалось добавить шаг. Проверьте селектор и текст.</p> : null}
    </form>
  );
}

const MODES: { value: UrlMatch["mode"]; label: string }[] = [
  { value: "exact", label: "Адрес ровно такой" },
  { value: "prefix", label: "Адрес начинается с" },
  { value: "contains", label: "Адрес содержит" },
  { value: "regex", label: "Адрес подходит под выражение" },
];

function Settings({
  tourId,
  projectId,
  match,
  showOnce,
}: {
  tourId: string;
  projectId: string;
  match: UrlMatch;
  showOnce: boolean;
}) {
  const update = useUpdateTour(tourId, projectId);
  const [draft, setDraft] = useState<UrlMatch>(match);

  return (
    <form
      className="install__block"
      data-testid="tour-settings"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ url_match: draft });
      }}
    >
      <h2>Где показывать</h2>
      <div className="projects__new-row">
        <label className="install__label" htmlFor="match-mode">
          Условие
        </label>
        <select
          id="match-mode"
          value={draft.mode}
          onChange={(event) => setDraft({ ...draft, mode: event.target.value as UrlMatch["mode"] })}
        >
          {MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Значение условия показа"
          value={draft.value}
          maxLength={500}
          onChange={(event) => setDraft({ ...draft, value: event.target.value })}
        />
        <button type="submit" disabled={update.isPending}>
          Сохранить
        </button>
      </div>
      <p className="install__hint">
        Сравнивается путь и query-строка адреса: без домена и без «#якоря», завершающий
        слэш не важен.
      </p>
      <label className="install__hint">
        <input
          type="checkbox"
          checked={showOnce}
          onChange={(event) => update.mutate({ show_once: event.target.checked })}
        />{" "}
        Показывать каждому посетителю только один раз
      </label>
      {update.isError ? (
        <p role="alert" data-testid="settings-error">
          Не удалось сохранить условие показа.
        </p>
      ) : null}
    </form>
  );
}
