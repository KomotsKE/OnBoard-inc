import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { AuthForm } from "../components/AuthForm";
import { useAuth } from "../components/AuthProvider";

/** S3 docs/screens.md. */
export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (status === "authenticated") {
    return <Navigate to={from ?? "/projects"} replace />;
  }

  return (
    <AuthForm
      title="Вход"
      submitLabel="Войти"
      footer={<>Нет аккаунта? <Link to="/register">Зарегистрируйтесь</Link></>}
      onSubmit={async (email, password) => {
        await login(email, password);
        // Возвращаем туда, откуда увёл ProtectedRoute, иначе к проектам.
        navigate(from ?? "/projects", { replace: true });
      }}
    />
  );
}
