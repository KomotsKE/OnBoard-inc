import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { TourListItem, UrlMatch } from "../api/tours";
import { useCreateTour, useDeleteTour, useTourPublication, useTours } from "../hooks/useTours";
import { Empty, ErrorState, Loading } from "../components/States";

/**
 * S7 docs/screens.md — список туров проекта.
 *
 * Метрики приходят в том же ответе, что и сами туры: отдельный запрос
 * аналитики на каждую строку превратил бы список из двадцати туров
 * в двадцать запросов.
 */
export function ToursPage() {
  const { projectId = "" } = useParams();
  const tours = useTours(projectId);
  const create = useCreateTour(projectId);
  const [name, setName] = useState("");

  if (tours.isPending) {
    return <Loading what="туры" />;
  }
  if (tours.isError) {
    return <ErrorState what="туры" onRetry={() => void tours.refetch()} error={tours.error} />;
  }

  return (
    <section>
      <h1>Туры</h1>

      <form
        className="projects__new"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) {
            return;
          }
          create.mutate(trimmed, { onSuccess: () => setName("") });
        }}
      >
        <label htmlFor="tour-name">Название нового тура</label>
        <div className="projects__new-row">
          <input
            id="tour-name"
            value={name}
            maxLength={200}
            placeholder="Например: знакомство с отчётами"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? "Создаём…" : "Создать"}
          </button>
        </div>
        {create.isError ? <p role="alert">Не удалось создать тур.</p> : null}
      </form>

      {tours.data.length === 0 ? (
        <Empty testId="tours-empty">
          Туров пока нет. Создайте первый — дальше в конструкторе добавите шаги и условие
          показа.
        </Empty>
      ) : (
        <div className="table">
          <table>
            <caption className="visually-hidden">Туры проекта</caption>
            <thead>
              <tr>
                <th scope="col">Тур</th>
                <th scope="col">Где показывается</th>
                <th scope="col" className="table__number">
                  Шагов
                </th>
                <th scope="col" className="table__number">
                  Запусков 7д
                </th>
                <th scope="col" className="table__number">
                  Завершение
                </th>
                <th scope="col">
                  <span className="visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tours.data.map((tour) => (
                <TourRow key={tour.id} projectId={projectId} tour={tour} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Условие показа словами: `url_match` в сыром виде читается плохо. */
export function matchLabel(match: UrlMatch): string {
  switch (match.mode) {
    case "exact":
      return `адрес страницы ровно «${match.value}»`;
    case "prefix":
      return `адрес начинается с «${match.value}»`;
    case "contains":
      return `адрес содержит «${match.value}»`;
    case "regex":
      return `адрес подходит под выражение «${match.value}»`;
  }
}

export function completionLabel(tour: TourListItem): string {
  if (tour.runs_7d === 0) {
    // «0 %» при нуле запусков — не ноль, а отсутствие данных.
    return "—";
  }
  return `${Math.round(tour.completion_rate_7d * 100)} %`;
}

function TourRow({ projectId, tour }: { projectId: string; tour: TourListItem }) {
  const publication = useTourPublication(projectId);
  const remove = useDeleteTour(projectId);
  const [confirming, setConfirming] = useState(false);
  const published = tour.status === "published";
  const blocked = !published && tour.steps_count === 0;

  return (
    <tr data-testid="tour-row">
      <td>
        <Link className="table__title" to={`/projects/${projectId}/tours/${tour.id}`}>
          {tour.name}
        </Link>{" "}
        <span className={published ? "tours__badge tours__badge--live" : "tours__badge"}>
          {published ? "опубликован" : "черновик"}
        </span>
        {blocked ? (
          <span className="table__note" data-testid="tour-no-steps">
            Чтобы опубликовать, добавьте хотя бы один шаг в конструкторе.
          </span>
        ) : null}
        {confirming ? (
          <span className="table__confirm" data-testid="tour-confirm">
            Удалить тур вместе с шагами и аналитикой?{" "}
            <button type="button" onClick={() => remove.mutate(tour.id)}>
              Удалить
            </button>{" "}
            <button type="button" onClick={() => setConfirming(false)}>
              Отмена
            </button>
          </span>
        ) : null}
      </td>
      <td>{matchLabel(tour.url_match)}</td>
      <td className="table__number">{tour.steps_count}</td>
      {/* Числа рядом друг с другом: сравнение туров — главное, ради чего
          список стал таблицей (S7 docs/screens.md). */}
      <td className="table__number" data-testid="tour-metrics">
        {tour.runs_7d === 0 ? "—" : tour.runs_7d}
      </td>
      <td className="table__number">{completionLabel(tour)}</td>
      <td className="table__actions">
        <Link to={`/projects/${projectId}/tours/${tour.id}`}>Конструктор</Link>
        <Link to={`/projects/${projectId}/tours/${tour.id}/analytics`}>Аналитика</Link>
        <button
          type="button"
          disabled={publication.isPending || blocked}
          // Публикация тура без шагов отклоняется сервером (422), но кнопку
          // лучше выключить заранее и сказать почему, чем показать ошибку.
          title={blocked ? "Сначала добавьте хотя бы один шаг в конструкторе" : undefined}
          onClick={() => publication.mutate({ id: tour.id, published: !published })}
        >
          {published ? "Снять с публикации" : "Опубликовать"}
        </button>
        <button type="button" className="projects__delete" onClick={() => setConfirming(true)}>
          Удалить
        </button>
      </td>
    </tr>
  );
}
