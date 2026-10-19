import { Navigate, Outlet, useLocation } from "react-router-dom";

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
      <main>
        <p data-testid="session-splash">Проверяем сессию…</p>
      </main>
    );
  }

  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
