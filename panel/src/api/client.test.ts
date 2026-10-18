import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, request } from "./client";

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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
