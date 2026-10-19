import { describe, expect, it } from "vitest";

import { hostsFromSnippet } from "./InstallPage";

const SNIPPET = `<script src="http://localhost:8080/widget/loader.js"
        data-key="pk_00000000000000000000000000000001"
        data-api="http://localhost:8000"
        async></script>`;

describe("адреса из сниппета", () => {
  it("разделяет домен файлов и домен запросов", () => {
    // Службе безопасности нужны оба: один в script-src, другой в connect-src.
    expect(hostsFromSnippet(SNIPPET)).toEqual({
      widget: "http://localhost:8080",
      api: "http://localhost:8000",
    });
  });

  it("на непонятном сниппете молчит, а не показывает мусор", () => {
    expect(hostsFromSnippet("<script></script>")).toBeNull();
    expect(hostsFromSnippet('<script src="не адрес" data-api="тоже"></script>')).toBeNull();
  });
});
