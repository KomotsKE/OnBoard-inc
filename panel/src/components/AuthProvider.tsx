import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import * as api from "../api/auth";
import { refreshSession, setAccessToken, setSessionLostHandler } from "../api/client";

/**
 * Сессия владельца: кто вошёл и как войти или выйти.
 *
 * Access-токен сюда не попадает — он живёт в памяти `api/client.ts`
 * (ADR-0008). Экранам нужен не токен, а ответ на вопрос «кто я».
 */

type Status = "loading" | "anonymous" | "authenticated";

type Auth = {
  status: Status;
  owner: api.Owner | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth вызван вне AuthProvider");
  }
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [owner, setOwner] = useState<api.Owner | null>(null);

  const forget = useCallback(() => {
    setOwner(null);
    setStatus("anonymous");
    // Кэш запросов принадлежал прошлому владельцу: следующий не должен
    // увидеть ни его проекты, ни его туры.
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    // Клиент сообщает сюда, что обновить сессию не удалось: решение, куда
    // вести пользователя, принимает приложение, а не слой запросов.
    setSessionLostHandler(forget);
    return () => setSessionLostHandler(null);
  }, [forget]);

  useEffect(() => {
    let cancelled = false;

    // Восстановление сессии при старте и после F5 (S0 docs/screens.md):
    // один обмен cookie на access-токен, затем «кто я».
    void (async () => {
      const restored = await refreshSession();
      if (cancelled) {
        return;
      }
      if (!restored) {
        setStatus("anonymous");
        return;
      }
      try {
        const current = await api.me();
        if (!cancelled) {
          setOwner(current);
          setStatus("authenticated");
        }
      } catch {
        if (!cancelled) {
          setStatus("anonymous");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enter = useCallback(
    async (
      action: (email: string, password: string) => Promise<api.Owner>,
      email: string,
      password: string,
    ) => {
      const current = await action(email, password);
      setOwner(current);
      setStatus("authenticated");
    },
    [],
  );

  const value = useMemo<Auth>(
    () => ({
      status,
      owner,
      login: (email, password) => enter(api.login, email, password),
      register: (email, password) => enter(api.register, email, password),
      logout: async () => {
        try {
          await api.logout();
        } finally {
          setAccessToken(null);
          forget();
        }
      },
    }),
    [status, owner, enter, forget],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
