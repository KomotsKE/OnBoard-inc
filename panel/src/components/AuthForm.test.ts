import { describe, expect, it } from "vitest";

import { ApiError } from "../api/client";
import { messageFor, passwordProblem } from "./AuthForm";

describe("проверка пароля до отправки", () => {
  it("пропускает длину, которую примет сервер", () => {
    expect(passwordProblem("a".repeat(15))).toBeNull();
    expect(passwordProblem("a".repeat(128))).toBeNull();
  });

  it("называет правило и текущую длину, а не имя поля", () => {
    // Сырое «проверьте поля: password» с бэкенда человеку ничего не говорит.
    expect(passwordProblem("a".repeat(14))).toBe("Пароль короче 15 символов: сейчас 14");
    expect(passwordProblem("")).toBe("Пароль короче 15 символов: сейчас 0");
    expect(passwordProblem("a".repeat(129))).toBe("Пароль длиннее 128 символов");
  });
});

describe("сообщение об отказе сервера", () => {
  it("не показывает список полей из ответа", () => {
    const failure = new ApiError(
      422,
      "/errors/validation",
      "Некорректные данные",
      "проверьте поля: password",
    );
    expect(messageFor(failure)).toBe("Проверьте адрес и пароль");
  });
});
