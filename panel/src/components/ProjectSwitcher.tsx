import { useNavigate, useParams } from "react-router-dom";

import { useProjects } from "../hooks/useProjects";

/**
 * Переключатель проектов в шапке (S1 docs/screens.md).
 *
 * Выбор проекта — это не состояние в памяти, а адрес: все экраны проекта
 * лежат под `/projects/:id/…`, поэтому переключение просто ведёт на тот же
 * раздел другого проекта. Так ссылка на экран остаётся ссылкой на экран.
 */
export function ProjectSwitcher() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { data: projects } = useProjects();

  if (!projects || projects.length === 0) {
    return null;
  }

  return (
    <select
      className="layout__switcher"
      aria-label="Проект"
      data-testid="project-switcher"
      value={projectId ?? ""}
      onChange={(event) => navigate(`/projects/${event.target.value}/tours`)}
    >
      {projectId ? null : (
        <option value="" disabled>
          Выберите проект
        </option>
      )}
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </select>
  );
}
