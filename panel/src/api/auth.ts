/**
 * Аутентификация владельца сайта (§3 docs/screens.md).
 *
 * Access-токен не возвращается наружу: его кладёт в память клиента
 * `setAccessToken`, а экраны видят только, кто вошёл (ADR-0008).
 */

import { request, setAccessToken } from "./client";

export type Owner = { id: string; email: string };

type TokenResponse = { access_token: string; expires_in: number };

async function authenticate(path: string, email: string, password: string): Promise<Owner> {
  const tokens = await request<TokenResponse>(path, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(tokens.access_token);
  return me();
}

export function register(email: string, password: string): Promise<Owner> {
  return authenticate("/auth/register", email, password);
}

export function login(email: string, password: string): Promise<Owner> {
  return authenticate("/auth/login", email, password);
}

export function me(): Promise<Owner> {
  return request<Owner>("/me");
}

export async function logout(): Promise<void> {
  try {
    await request<void>("/auth/logout", { method: "POST" });
  } finally {
    // Даже если сервер не ответил, локально сессии больше нет.
    setAccessToken(null);
  }
}
