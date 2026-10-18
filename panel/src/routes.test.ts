import { describe, expect, it } from "vitest";

import { routePaths } from "./routes";

/** Пути из §1 docs/screens.md — каркас обязан покрывать их все. */
const EXPECTED = [
  "/",
  "/login",
  "/register",
  "/projects",
  "/projects/:projectId/install",
  "/projects/:projectId/tours",
  "/projects/:projectId/tours/:tourId",
  "/projects/:projectId/tours/:tourId/analytics",
  "/projects/:projectId/branding",
  "*",
];

describe("маршруты панели", () => {
  it("покрывают все экраны из screens.md", () => {
    expect(routePaths().sort()).toEqual([...EXPECTED].sort());
  });

  it("включают перехват неизвестного пути", () => {
    expect(routePaths()).toContain("*");
  });
});
