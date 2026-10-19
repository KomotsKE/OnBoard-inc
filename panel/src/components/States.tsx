import type { ReactNode } from "react";

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

export function ErrorState({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <section className="state">
      {/* role="alert": с клавиатуры и экранным диктором сообщение иначе
          остаётся незамеченным. */}
      <p role="alert">Не удалось загрузить {what}.</p>
      <button type="button" onClick={onRetry}>
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
