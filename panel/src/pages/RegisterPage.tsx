import { Link, Navigate, useNavigate } from "react-router-dom";

import { AuthForm } from "../components/AuthForm";
import { useAuth } from "../components/AuthProvider";

/** S2 docs/screens.md. */
export function RegisterPage() {
  const { status, register } = useAuth();
  const navigate = useNavigate();

  if (status === "authenticated") {
    return <Navigate to="/projects" replace />;
  }

  return (
    <AuthForm
      title="Регистрация"
      submitLabel="Создать аккаунт"
      // Требование к длине показываем заранее: узнать о нём из ошибки после
      // отправки — худший способ.
      hint="Не короче 15 символов. Требований к составу нет: длина надёжнее."
      footer={<>Уже есть аккаунт? <Link to="/login">Войдите</Link></>}
      onSubmit={async (email, password) => {
        await register(email, password);
        navigate("/projects", { replace: true });
      }}
    />
  );
}
