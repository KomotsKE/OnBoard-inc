import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "../api/client";

/**
 * Три состояния, которые обязаны быть обработаны у каждого экрана: загрузка,
 * ошибка, пусто (§4.6 docs/vision.md). Белый экран при ошибке запроса —
 * дефект, а не «не дошли руки».
 *
 * Компоненты общие, чтобы состояния выглядели и вели себя одинаково на всех
 * экранах: до этого один и тот же блок был скопирован в пять файлов.
 */

export function Loading({ what }: { what: string }) {
  return <p className="state">Загружаем {what}…</p>;
}

/**
 * «Не найдено» — один экран на две причины.
 *
 * API отвечает 404 и на несуществующий объект, и на чужой, не различая их
 * (ADR-0006). Экран тоже не различает: иначе по тексту можно было бы узнать,
 * что чужой проект существует.
 */
export function NotFound() {
  return (
    <section className="state state--empty">
      <h1>Не найдено</h1>
      <p>Такого адреса нет — или объект принадлежит другому аккаунту.</p>
      <p className="install__hint">
        Мы намеренно не различаем эти случаи: иначе по ответу можно было бы узнать, что
        чужой проект существует.
      </p>
      <Link className="btn btn--primary" to="/projects">
        К проектам
      </Link>
    </section>
  );
}

export function ErrorState({
  what,
  onRetry,
  error,
}: {
  what: string;
  onRetry: () => void;
  error?: unknown;
}) {
  // 404 — это не сбой загрузки, а ответ по существу: предлагать «Повторить»
  // здесь бессмысленно.
  if (error instanceof ApiError && error.status === 404) {
    return <NotFound />;
  }

  return (
    <section className="state">
      {/* role="alert": с клавиатуры и экранным диктором сообщение иначе
          остаётся незамеченным. */}
      <p role="alert">Не удалось загрузить {what}.</p>
      <button type="button" className="btn" onClick={onRetry}>
        Повторить
      </button>
    </section>
  );
}

export function Empty({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p className="state" data-testid={testId}>
      {children}
    </p>
  );
}
