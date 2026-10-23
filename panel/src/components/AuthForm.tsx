import { useState } from "react";

import { ApiError } from "../api/client";

/**
 * Форма входа и регистрации: поля одни и те же, отличаются заголовок, кнопка
 * и ссылка внизу. Второе использование — повод для общего компонента
 * (§9 docs/conventions.md).
 */

/** Длина из §5.1 docs/data-model.md: требований к составу нет, только длина. */
const PASSWORD_MIN = 15;
const PASSWORD_MAX = 128;

/**
 * Длину проверяем до отправки: иначе человек получает в ответ список полей
 * бэкенда («проверьте поля: password») и зря тратит попытку из лимита
 * регистраций (§9.2 docs/vision.md).
 */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) {
    return `Пароль короче ${PASSWORD_MIN} символов: сейчас ${password.length}`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Пароль длиннее ${PASSWORD_MAX} символов`;
  }
  return null;
}

type Props = {
  title: string;
  submitLabel: string;
  hint?: string;
  footer: React.ReactNode;
  onSubmit: (email: string, password: string) => Promise<void>;
};

/** Понятная причина отказа вместо кода ответа. */
export function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.";
  }
  switch (error.status) {
    case 401:
      // Сервер намеренно не говорит, что именно неверно (§3 docs/screens.md).
      return "Неверный адрес или пароль";
    case 409:
      return "Эта почта уже зарегистрирована";
    case 429:
      return "Слишком много попыток. Подождите немного и повторите.";
    case 422:
      // detail бэкенда перечисляет поля латиницей — это не текст для человека.
      return "Проверьте адрес и пароль";
    default:
      return error.detail ?? error.title;
  }
}

export function AuthForm({ title, submitLabel, hint, footer, onSubmit }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(email.trim(), password);
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth">
      <h1>{title}</h1>
      <form onSubmit={submit} noValidate>
        <label htmlFor="email">Почта</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="password">Пароль</label>
        <input
          id="password"
          type="password"
          autoComplete={submitLabel === "Войти" ? "current-password" : "new-password"}
          required
          minLength={PASSWORD_MIN}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {hint ? <p className="auth__hint">{hint}</p> : null}

        {/* Сообщение об ошибке объявляется вслух: с клавиатуры оно иначе
            остаётся незамеченным. */}
        {error ? (
          <p className="auth__error" role="alert" data-testid="auth-error">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Отправляем…" : submitLabel}
        </button>
      </form>
      <p>{footer}</p>
    </section>
  );
}
