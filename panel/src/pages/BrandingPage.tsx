import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { Project } from "../api/projects";
import { ErrorState, Loading } from "../components/States";
import { TooltipPreview } from "../components/TooltipPreview";
import { useProject } from "../hooks/useProjects";
import { useUpdateTheme } from "../hooks/useTheme";

/**
 * S6 docs/screens.md — тема оформления проекта.
 *
 * Превью живое: значения подставляются в него сразу, до сохранения. Иначе
 * владелец подбирает цвет вслепую, сохраняя каждый вариант.
 */

const FIELDS = [
  { key: "next_label", label: "Кнопка «дальше»" },
  { key: "skip_label", label: "Кнопка «пропустить»" },
  { key: "done_label", label: "Кнопка на последнем шаге" },
] as const;

const PREVIEW_STEP = {
  title: "Фильтры переехали",
  body: "Теперь они здесь. Нажмите, чтобы сузить выборку.",
};

export function BrandingPage() {
  const { projectId = "" } = useParams();
  const project = useProject(projectId);
  const update = useUpdateTheme(projectId);
  const [draft, setDraft] = useState<Project["theme"] | null>(null);

  if (project.isPending) {
    return <Loading what="оформление" shape="branding" />;
  }
  if (project.isError) {
    return <ErrorState what="оформление" onRetry={() => void project.refetch()} error={project.error} />;
  }

  const theme = draft ?? project.data.theme;
  const set = (key: string, value: string | number) => setDraft({ ...theme, [key]: value });
  const changed = JSON.stringify(theme) !== JSON.stringify(project.data.theme);

  return (
    <section className="branding page">
      <div className="page__head">
        <p>
          <Link to={`/projects/${projectId}/tours`}>← К турам</Link>
        </p>
        <h1>Оформление</h1>
        <p>Как подсказки выглядят на вашем сайте. Применяется ко всем турам проекта.</p>
      </div>

      <div className="split">
        <form
          className="step-form"
          data-testid="branding-form"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate(theme, { onSuccess: () => setDraft(null) });
          }}
        >
          <label htmlFor="primary">Основной цвет</label>
          <input
            id="primary"
            type="color"
            value={String(theme.primary_color ?? "#2563eb")}
            onChange={(event) => set("primary_color", event.target.value)}
          />

          <label htmlFor="text">Цвет текста</label>
          <input
            id="text"
            type="color"
            value={String(theme.text_color ?? "#0f172a")}
            onChange={(event) => set("text_color", event.target.value)}
          />

          <label htmlFor="backdrop">Затемнение страницы</label>
          <input
            id="backdrop"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={Number(theme.backdrop_opacity ?? 0.55)}
            onChange={(event) => set("backdrop_opacity", Number(event.target.value))}
          />
          <p className="install__hint">
            {Math.round(Number(theme.backdrop_opacity ?? 0.55) * 100)} % — насколько
            гасится страница вокруг подсвеченного элемента
          </p>

          <label htmlFor="radius">Скругление углов</label>
          <input
            id="radius"
            value={String(theme.border_radius ?? "8px")}
            maxLength={16}
            onChange={(event) => set("border_radius", event.target.value)}
          />

          <label htmlFor="font">Шрифт</label>
          <input
            id="font"
            value={String(theme.font_family ?? "")}
            maxLength={200}
            onChange={(event) => set("font_family", event.target.value)}
          />

          {FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={field.key}>{field.label}</label>
              <input
                id={field.key}
                value={String(theme[field.key] ?? "")}
                maxLength={40}
                onChange={(event) => set(field.key, event.target.value)}
              />
            </div>
          ))}

          <div className="projects__new-row step-form__actions">
            <button type="submit" className="btn btn--primary" disabled={!changed || update.isPending}>
              {update.isPending ? "Сохраняем…" : changed ? "Сохранить" : "Сохранено"}
            </button>
            {changed ? (
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Вернуть как было
              </button>
            ) : null}
          </div>

          {update.isError ? (
            <p role="alert" data-testid="branding-error">
              Не удалось сохранить оформление. Цвета задаются как #RRGGBB, подписи — до
              40 символов.
            </p>
          ) : null}
        </form>

        <div>
          <TooltipPreview step={PREVIEW_STEP} index={1} total={3} theme={theme} />
          <p className="install__hint">
            Сниппет на сайте переустанавливать не нужно: тема приезжает вместе
            с конфигурацией. У посетителей, уже открывших страницу, изменения появятся
            в течение минуты — столько живёт кэш конфигурации.
          </p>
        </div>
      </div>
    </section>
  );
}
