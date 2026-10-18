/**
 * Единственная точка обращения к API (§5 docs/conventions.md).
 * `fetch` внутри компонентов запрещён — компоненты видят только хуки.
 *
 * Обработка 401 с обновлением токена появится здесь в T3.1: она живёт в одном
 * месте, чтобы ни один хук не проверял «а не истёк ли токен».
 */

const BASE = "/v1";

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

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    // Refresh-токен лежит в httpOnly cookie, поэтому запросы идут с ней.
    credentials: "include",
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
