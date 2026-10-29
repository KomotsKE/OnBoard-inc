import { useState } from "react";
import { Link } from "react-router-dom";

import type { Project } from "../api/projects";
import { useCreateProject, useDeleteProject, useProjects } from "../hooks/useProjects";
import { Empty, ErrorState, Loading } from "../components/States";
import { plural } from "../text";

/**
 * S4 docs/screens.md — список проектов и создание нового.
 *
 * Это же первый экран после регистрации, поэтому пустое состояние не
 * «ничего не найдено», а приглашение начать.
 */
export function ProjectsPage() {
  const { data: projects, isPending, isError, refetch } = useProjects();
  const create = useCreateProject();
  const [name, setName] = useState("");

  if (isPending) {
    return <Loading what="проекты" shape="projects" />;
  }
  if (isError) {
    return <ErrorState what="проекты" onRetry={() => void refetch()} />;
  }

  return (
    <section>
      <div className="page__head">
        <h1>Проекты</h1>
      </div>

      <form
        className="projects__new"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) {
            return;
          }
          create.mutate(trimmed, { onSuccess: () => setName("") });
        }}
      >
        <label htmlFor="project-name">Название нового проекта</label>
        <div className="projects__new-row">
          <input
            id="project-name"
            value={name}
            maxLength={200}
            placeholder="Например: интернет-магазин"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="btn btn--primary" disabled={create.isPending}>
            {create.isPending ? "Создаём…" : "Создать"}
          </button>
        </div>
        {create.isError ? <p role="alert">Не удалось создать проект.</p> : null}
      </form>

      {projects.length === 0 ? (
        <Empty testId="projects-empty">
          Проектов пока нет. Создайте первый — это сайт, на котором будет работать виджет.
        </Empty>
      ) : (
        <ul className="projects">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const remove = useDeleteProject();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <li className="projects__card" data-testid="project-card">
      <div className="projects__row">
        <div className="projects__about">
          <h2>
            <Link to={`/projects/${project.id}/tours`}>{project.name}</Link>
          </h2>
          <p>
            {/* Владельцу важно «виджет найден», а не когда именно (S4).
                Состояние названо словом: по одному цвету список не читается. */}
            <span
              className={
                project.widget_connected
                  ? "tours__badge tours__badge--live"
                  : "tours__badge"
              }
              data-testid="widget-state"
            >
              {project.widget_connected ? "виджет подключён" : "виджет ещё не найден"}
            </span>{" "}
            · {toursLabel(project.tours_count)} ·{" "}
            {project.allowed_origins.length > 0
              ? project.allowed_origins.join(", ")
              : "доменов нет"}
          </p>
          <code className="projects__key" data-testid="project-key">
            {project.public_key}
          </code>
        </div>

        <p className="projects__links">
          <Link className="btn" to={`/projects/${project.id}/tours`}>Туры</Link>
          <Link className="btn" to={`/projects/${project.id}/install`}>Установка</Link>
          <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
            Удалить
          </button>
        </p>
      </div>

      {project.widget_connected ? null : (
        <p className="projects__hint">
          Виджет ещё ни разу не запрашивал конфигурацию. Поставьте сниппет на страницы
          сайта — он на экране «Установка».
        </p>
      )}

      {confirming ? (
        <form
          className="projects__confirm"
          onSubmit={(event) => {
            event.preventDefault();
            remove.mutate(project.id);
          }}
        >
          {/* Каскад уносит туры, шаги и все события проекта
              (§8 docs/data-model.md), поэтому подтверждение — с именем. */}
          <p>
            Удаление уносит туры, шаги и всю аналитику проекта. Введите «{project.name}», чтобы
            подтвердить.
          </p>
          <div className="projects__new-row">
            <input
              aria-label={`Подтверждение удаления проекта ${project.name}`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
            <button type="submit" className="btn btn--danger" disabled={typed !== project.name || remove.isPending}>
              Удалить навсегда
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setConfirming(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** «1 тур», «2 тура», «5 туров» — иначе интерфейс выглядит машинным. */
export function toursLabel(count: number): string {
  return plural(count, ["тур", "тура", "туров"]);
}
