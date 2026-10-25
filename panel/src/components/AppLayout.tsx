import { Link, Outlet, useNavigate, useParams } from "react-router-dom";

import { useProjects } from "../hooks/useProjects";
import { useAuth } from "./AuthProvider";
import { ProjectNav } from "./ProjectNav";
import { ProjectSwitcher } from "./ProjectSwitcher";

function AsideWidgetState() {
  const { projectId } = useParams();
  const { data: projects } = useProjects();
  const project = projects?.find((item) => item.id === projectId);

  if (!project) {
    return null;
  }

  return (
    <p
      className={
        project.widget_connected
          ? "console__widget console__widget--live"
          : "console__widget"
      }
      data-testid="aside-widget-state"
    >
      <span className="banner__dot" aria-hidden="true" />
      {project.widget_connected ? "Виджет подключён" : "Виджет ещё не найден"}
    </p>
  );
}

/**
 * Рамка приватных экранов: слева — проект и его разделы, справа — экран.
 *
 * Навигация постоянная, а не в шапке у конкретного экрана: разделы проекта
 * должны быть достижимы отовсюду, иначе до «Оформления» можно добраться
 * только по прямому адресу (S1 docs/screens.md).
 *
 * Почту берём из провайдера, а не запрашиваем `/v1/me` отдельно: провайдер
 * уже сделал этот запрос, восстанавливая сессию.
 */
export function AppLayout() {
  const { owner, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="console">
      <aside className="console__aside">
        <Link className="console__brand" to="/projects">
          <svg width="24" height="24" viewBox="0 0 32 32" role="img" aria-label="OnBoard">
            <circle
              cx="16"
              cy="16"
              r="11"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="42 12"
              transform="rotate(-60 16 16)"
            />
            <circle cx="16" cy="16" r="4.5" fill="currentColor" />
          </svg>
          OnBoard
        </Link>

        <ProjectSwitcher />
        <ProjectNav />
        <AsideWidgetState />

        <div className="console__owner">
          <span data-testid="owner-email">{owner?.email}</span>
          <button
            type="button"
            className="btn btn--quiet"
            data-testid="logout"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            Выйти
          </button>
        </div>
      </aside>

      <main className="console__main">
        <Outlet />
      </main>
    </div>
  );
}
