import { NavLink, useParams } from "react-router-dom";

/**
 * Разделы текущего проекта (S1 docs/screens.md).
 *
 * Показываются только внутри проекта: пока он не выбран, ссылкам некуда
 * вести. Аналитика сюда не входит — она принадлежит туру, а не проекту,
 * и открывается из его строки в списке.
 */

const SECTIONS = [
  { to: "tours", label: "Туры" },
  { to: "branding", label: "Оформление" },
  { to: "install", label: "Установка" },
];

export function ProjectNav() {
  const { projectId } = useParams();

  if (!projectId) {
    return null;
  }

  return (
    <nav className="console__nav" aria-label="Разделы проекта" data-testid="project-nav">
      {SECTIONS.map((section) => (
        <NavLink
          key={section.to}
          to={`/projects/${projectId}/${section.to}`}
          className={({ isActive }) =>
            isActive ? "console__link console__link--current" : "console__link"
          }
        >
          {section.label}
        </NavLink>
      ))}
    </nav>
  );
}
