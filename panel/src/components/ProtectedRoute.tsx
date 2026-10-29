import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Skeleton } from "./Skeleton";
import { useAuth } from "./AuthProvider";

/**
 * Приватные экраны. Пока сессия восстанавливается, показывается сплэш, а не
 * экран логина: иначе владелец при каждом F5 видел бы форму входа и считал,
 * что его выкинуло (ADR-0008).
 */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      // Форма одна для всех адресов: до восстановления сессии маршрут ещё не
      // отрисован. Компромисс — при прямой ссылке на другой экран форма сменится.
      <main>
        <Skeleton what="сессию" shape="projects" />
      </main>
    );
  }

  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
