import { NotFound } from "../components/States";

/**
 * Экран «не найдено» для неизвестного адреса. Выглядит так же, как ответ 404
 * на чужой объект: человеку это одно и то же событие (ADR-0006).
 */
export function NotFoundPage() {
  return <NotFound />;
}
