import { useState, type ReactNode } from "react";

interface AuthLayoutProps {
  photo: string;
  title: string;
  lead: string;
  children: ReactNode;
}

/** Композиция экранов входа и регистрации: снимок под затемнением и карточка. */
export function AuthLayout({ photo, title, lead, children }: AuthLayoutProps) {
  // Снимок необязателен: при ошибке загрузки прячем его, подложка остаётся.
  const [photoFailed, setPhotoFailed] = useState(false);

  return (
    <div className="auth-screen">
      {/* Без loading="lazy": снимок выше сгиба, это LCP-элемент. */}
      <img
        className="auth-screen__photo"
        src={photo}
        alt=""
        decoding="async"
        data-testid="auth-photo"
        hidden={photoFailed}
        onError={() => setPhotoFailed(true)}
      />
      <div>
        <div className="auth-screen__brand">
          <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
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
        </div>
        <p className="auth-screen__title">{title}</p>
        <p className="auth-screen__lead">{lead}</p>
      </div>
      <div className="auth-screen__card" data-testid="auth-card">
        {children}
      </div>
    </div>
  );
}
