import { Navigate, type RouteObject } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import {
  AnalyticsPage,
  BrandingPage,
  InstallPage,
  LoginPage,
  NotFoundPage,
  ProjectsPage,
  TourBuilderPage,
  ToursPage,
  RegisterPage,
} from "./pages/placeholders";

/**
 * Маршруты панели — §1 docs/screens.md. Вынесены отдельным модулем, чтобы
 * состав путей можно было проверить тестом без рендера.
 *
 * `ProtectedRoute` появится в T3.1: сейчас защищать нечего, а заготовка без
 * проверки сессии создавала бы ложное ощущение, что доступ ограничен.
 */
export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/projects" replace /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
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
  { path: "*", element: <NotFoundPage /> },
];

/** Плоский список путей — для проверки полноты каркаса. */
export function routePaths(list: RouteObject[] = routes): string[] {
  return list.flatMap((route) => [
    ...(route.path ? [route.path] : []),
    ...(route.children ? routePaths(route.children) : []),
  ]);
}
