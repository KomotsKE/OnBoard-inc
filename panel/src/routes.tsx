import { Navigate, type RouteObject } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import {
  AnalyticsPage,
  BrandingPage,
  InstallPage,
  NotFoundPage,
  ProjectsPage,
  TourBuilderPage,
  ToursPage,
} from "./pages/placeholders";

/**
 * Маршруты панели — §1 docs/screens.md. Вынесены отдельным модулем, чтобы
 * состав путей можно было проверить тестом без рендера.
 *
 * Всё, что под `ProtectedRoute`, требует сессии: без неё — редирект на
 * `/login` с запоминанием адреса, куда человек шёл.
 */
export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/projects" replace /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/projects", element: <ProjectsPage /> },
          { path: "/projects/:projectId/install", element: <InstallPage /> },
          { path: "/projects/:projectId/tours", element: <ToursPage /> },
          { path: "/projects/:projectId/tours/:tourId", element: <TourBuilderPage /> },
          { path: "/projects/:projectId/tours/:tourId/analytics", element: <AnalyticsPage /> },
          { path: "/projects/:projectId/branding", element: <BrandingPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];

/** Плоский список путей — для проверки полноты каркаса. */
export function routePaths(list: RouteObject[] = routes): string[] {
  return list.flatMap((route) => [
    ...(route.path ? [route.path] : []),
    ...(route.children ? routePaths(route.children) : []),
  ]);
}
