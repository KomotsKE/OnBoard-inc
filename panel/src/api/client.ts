/**
 * Единственная точка обращения к API (§5 docs/conventions.md).
 * `fetch` внутри компонентов запрещён — компоненты видят только хуки.
 *
 * Здесь же вся работа с истёкшим токеном: ни один хук и ни один экран не
 * спрашивают «а не пора ли обновиться».
 */

const BASE = "/v1";

/**
 * Access-токен живёт только в памяти модуля (ADR-0008). В `localStorage` его
 * нет намеренно: оттуда XSS уводит доступ на все 30 дней жизни refresh-токена,
 * а так — максимум на 15 минут.
 */
let accessToken: string | null = null;

/**
 * Один общий промис обновления.
 *
 * Экран панели легко делает четыре-пять запросов разом; если у каждого на 401
 * будет свой `/auth/refresh`, сервер получит пачку обменов одной и той же
 * cookie, а ротация токенов (ADR-0008) посчитает это повторным использованием
 * и погасит всю цепочку — то есть выкинет живого пользователя.
 */
let refreshing: Promise<boolean> | null = null;

/** Сессия окончательно потеряна: провайдер уводит на экран входа. */
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

/** Ошибка API в формате RFC 9457 (§4 docs/conventions.md). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(title);
    this.name = "ApiError";
  }
}

type Problem = {
  type?: string;
  title?: string;
  detail?: string;
};

async function toApiError(response: Response): Promise<ApiError> {
  let problem: Problem = {};
  try {
    problem = (await response.json()) as Problem;
  } catch {
    // Ответ без тела или не JSON — остаётся статус, этого достаточно.
  }
  return new ApiError(
    response.status,
    problem.type ?? "/errors/unknown",
    problem.title ?? `Ошибка ${response.status}`,
    problem.detail,
  );
}

function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
    // Refresh-токен лежит в httpOnly cookie, поэтому запросы идут с ней.
    credentials: "include",
  });
}

async function exchangeRefreshToken(): Promise<boolean> {
  try {
    const response = await send("/auth/refresh", { method: "POST" });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { access_token: string };
    accessToken = body.access_token;
    return true;
  } catch {
    // Сеть отвалилась — это не «сессии нет», но и продолжить нечем.
    return false;
  }
}

/** Обновляет сессию по cookie. Параллельные вызовы ждут один обмен. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    const started = exchangeRefreshToken();
    refreshing = started;
    void started.finally(() => {
      // Следующий 401 начнёт новый обмен, а не получит старый ответ.
      refreshing = null;
    });
  }
  return refreshing;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await send(path, init);

  // На маршрутах аутентификации обновлять нечего: они и есть обмен токенами.
  if (response.status === 401 && !path.startsWith("/auth/")) {
    if (!(await refreshSession())) {
      accessToken = null;
      onSessionLost?.();
      throw await toApiError(response);
    }
    // Ровно один повтор: если и он даёт 401, дело не в сроке жизни токена.
    response = await send(path, init);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
