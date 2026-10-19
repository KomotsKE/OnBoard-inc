import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { TourListItem, UrlMatch } from "../api/tours";
import { useCreateTour, useDeleteTour, useTourPublication, useTours } from "../hooks/useTours";
import { Empty, ErrorState, Loading } from "../components/States";
import { plural } from "../text";

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
    return <ErrorState what="туры" onRetry={() => void tours.refetch()} />;
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
        <ul className="projects">
          {tours.data.map((tour) => (
            <TourRow key={tour.id} projectId={projectId} tour={tour} />
          ))}
        </ul>
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
    return "за 7 дней запусков не было";
  }
  const percent = Math.round(tour.completion_rate_7d * 100);
  return `${plural(tour.runs_7d, ["запуск", "запуска", "запусков"])} за 7 дней, дошли до конца ${percent} %`;
}

function TourRow({ projectId, tour }: { projectId: string; tour: TourListItem }) {
  const publication = useTourPublication(projectId);
  const remove = useDeleteTour(projectId);
  const [confirming, setConfirming] = useState(false);
  const published = tour.status === "published";

  return (
    <li className="projects__card" data-testid="tour-row">
      <h2>
        <Link to={`/projects/${projectId}/tours/${tour.id}`}>{tour.name}</Link>
      </h2>
      <p>
        <span className={published ? "tours__badge tours__badge--live" : "tours__badge"}>
          {published ? "Опубликован" : "Черновик"}
        </span>{" "}
        · {plural(tour.steps_count, ["шаг", "шага", "шагов"])} · {matchLabel(tour.url_match)}
      </p>
      <p data-testid="tour-metrics">{completionLabel(tour)}</p>

      <p className="projects__links">
        <Link to={`/projects/${projectId}/tours/${tour.id}`}>Конструктор</Link>
        <Link to={`/projects/${projectId}/tours/${tour.id}/analytics`}>Аналитика</Link>
        <button
          type="button"
          disabled={publication.isPending || (!published && tour.steps_count === 0)}
          // Публикация тура без шагов отклоняется сервером (422), но кнопку
          // лучше выключить заранее и сказать почему, чем показать ошибку.
          title={
            !published && tour.steps_count === 0
              ? "Сначала добавьте хотя бы один шаг в конструкторе"
              : undefined
          }
          onClick={() => publication.mutate({ id: tour.id, published: !published })}
        >
          {published ? "Снять с публикации" : "Опубликовать"}
        </button>
        <button type="button" className="projects__delete" onClick={() => setConfirming(true)}>
          Удалить
        </button>
      </p>

      {!published && tour.steps_count === 0 ? (
        <p className="install__hint" data-testid="tour-no-steps">
          Чтобы опубликовать, добавьте хотя бы один шаг в конструкторе.
        </p>
      ) : null}

      {confirming ? (
        <p className="projects__confirm" data-testid="tour-confirm">
          Удалить тур «{tour.name}» вместе с шагами и его аналитикой?{" "}
          <button type="button" onClick={() => remove.mutate(tour.id)}>
            Удалить
          </button>{" "}
          <button type="button" onClick={() => setConfirming(false)}>
            Отмена
          </button>
        </p>
      ) : null}
    </li>
  );
}
