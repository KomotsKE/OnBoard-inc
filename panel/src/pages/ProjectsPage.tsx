import { useState } from "react";
import { Link } from "react-router-dom";

import type { Project } from "../api/projects";
import { useCreateProject, useDeleteProject, useProjects } from "../hooks/useProjects";
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
    return <p>Загружаем проекты…</p>;
  }

  if (isError) {
    return (
      <section>
        <p role="alert">Не удалось загрузить проекты.</p>
        <button type="button" onClick={() => void refetch()}>
          Повторить
        </button>
      </section>
    );
  }

  return (
    <section>
      <h1>Проекты</h1>

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
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? "Создаём…" : "Создать"}
          </button>
        </div>
        {create.isError ? <p role="alert">Не удалось создать проект.</p> : null}
      </form>

      {projects.length === 0 ? (
        <p data-testid="projects-empty">
          Проектов пока нет. Создайте первый — это сайт, на котором будет работать виджет.
        </p>
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
      <h2>
        <Link to={`/projects/${project.id}/tours`}>{project.name}</Link>
      </h2>
      <p>
        {/* Владельцу важно «виджет найден», а не когда именно (S4). */}
        {project.widget_connected ? "Виджет подключён" : "Виджет ещё не найден"} ·{" "}
        {toursLabel(project.tours_count)}
      </p>
      <p className="projects__links">
        <Link to={`/projects/${project.id}/tours`}>Туры</Link>
        <Link to={`/projects/${project.id}/install`}>Установка</Link>
        <button type="button" className="projects__delete" onClick={() => setConfirming(true)}>
          Удалить
        </button>
      </p>

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
            <button type="submit" disabled={typed !== project.name || remove.isPending}>
              Удалить навсегда
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
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
