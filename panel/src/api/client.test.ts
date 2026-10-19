import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, request, setAccessToken, setSessionLostHandler } from "./client";

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  // Токен и обработчик живут в памяти модуля: между тестами их надо сбросить.
  setAccessToken(null);
  setSessionLostHandler(null);
});

/** Отвечает по адресу запроса: протухший токен, обмен и повтор различимы. */
function stubApi(options: {
  protectedStatus?: number[];
  refreshStatus?: number;
}): ReturnType<typeof vi.fn> {
  const statuses = [...(options.protectedStatus ?? [200])];
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/auth/refresh")) {
      const status = options.refreshStatus ?? 200;
      return new Response(status === 200 ? JSON.stringify({ access_token: "новый" }) : "{}", {
        status,
      });
    }
    const status = statuses.shift() ?? 200;
    return new Response(JSON.stringify({ ok: status === 200 }), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("клиент API", () => {
  it("обращается к /v1 и передаёт cookie", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await request("/me");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/me");
    // Refresh-токен живёт в httoOnly cookie (ADR-0008), без этого сессия
    // не восстановится после перезагрузки страницы.
    expect(init.credentials).toBe("include");
  });

  it("разбирает ошибку в формате RFC 9457", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          type: "/errors/not-found",
          title: "Объект не найден",
          detail: "тур удалён",
        }),
        { status: 404 },
      ),
    );

    const error = await request("/tours/1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      type: "/errors/not-found",
      title: "Объект не найден",
      detail: "тур удалён",
    });
  });

  it("не падает на ошибке без тела", async () => {
    stubFetch(new Response(null, { status: 503 }));

    const error = (await request("/health").catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(503);
    expect(error.type).toBe("/errors/unknown");
  });

  it("возвращает undefined на 204", async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(request("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });
});

describe("истёкший токен", () => {
  it("подставляет access-токен в заголовок", async () => {
    const fetchMock = stubApi({});
    setAccessToken("живой");

    await request("/me");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer живой");
  });

  it("на 401 обновляет сессию и повторяет запрос один раз", async () => {
    const fetchMock = stubApi({ protectedStatus: [401, 200] });

    await request("/projects");

    const paths = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(paths).toEqual(["/v1/projects", "/v1/auth/refresh", "/v1/projects"]);
  });

  it("пять параллельных запросов с 401 дают один вызов /auth/refresh", async () => {
    // Ротация refresh-токенов (ADR-0008) считает повторный обмен одной и той
    // же cookie кражей и гасит всю цепочку — то есть выкидывает живого
    // пользователя. Поэтому обмен обязан быть один.
    const fetchMock = stubApi({ protectedStatus: [401, 401, 401, 401, 401, 200, 200, 200, 200, 200] });

    await Promise.all([
      request("/projects"),
      request("/tours"),
      request("/me"),
      request("/projects/1"),
      request("/projects/2"),
    ]);

    const refreshes = fetchMock.mock.calls.filter((call) =>
      String((call as unknown[])[0]).endsWith("/auth/refresh"),
    );
    expect(refreshes).toHaveLength(1);
  });

  it("если обновить не удалось, сообщает о потере сессии", async () => {
    stubApi({ protectedStatus: [401], refreshStatus: 401 });
    const lost = vi.fn();
    setSessionLostHandler(lost);

    const error = await request("/projects").catch((failure: unknown) => failure);

    expect(lost).toHaveBeenCalledTimes(1);
    expect((error as ApiError).status).toBe(401);
  });

  it("401 на самих маршрутах аутентификации не запускает обновление", async () => {
    // Иначе неверный пароль превращался бы в бесконечную карусель обменов.
    const fetchMock = stubApi({ protectedStatus: [401] });

    await request("/auth/login", { method: "POST", body: "{}" }).catch(() => undefined);

    const paths = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(paths).toEqual(["/v1/auth/login"]);
  });
});
