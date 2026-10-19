import { Link, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "./AuthProvider";
import { ProjectSwitcher } from "./ProjectSwitcher";

/**
 * Общая рамка приватных экранов: переключатель проектов, кто вошёл и выход.
 *
 * Почту берём из провайдера, а не запрашиваем `/v1/me` отдельно: провайдер
 * уже сделал этот запрос, восстанавливая сессию.
 */
export function AppLayout() {
  const { owner, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <header>
        <Link to="/projects">OnBoard</Link>
        <ProjectSwitcher />
        <span className="layout__owner" data-testid="owner-email">
          {owner?.email}
        </span>
        <button
          type="button"
          className="layout__logout"
          data-testid="logout"
          onClick={async () => {
            await logout();
            navigate("/login", { replace: true });
          }}
        >
          Выйти
        </button>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
