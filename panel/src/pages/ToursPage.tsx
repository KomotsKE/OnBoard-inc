import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { TourListItem, UrlMatch } from "../api/tours";
import { useCreateTour, useDeleteTour, useTourPublication, useTours } from "../hooks/useTours";
import { RowMenu } from "../components/RowMenu";
import { Empty, ErrorState, Loading } from "../components/States";
import { plural } from "../text";

const NEW_TOUR_FORM_ID = "new-tour-form";

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
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const userToggled = useRef(false);

  // Фокус двигается только после явного нажатия: при первом показе формы
  // на пустом списке он остаётся где был.
  useEffect(() => {
    if (!userToggled.current) {
      return;
    }
    userToggled.current = false;
    if (open) {
      nameRef.current?.focus();
    } else {
      toggleRef.current?.focus();
    }
  }, [open]);

  if (tours.isPending) {
    return <Loading what="туры" shape="tours" />;
  }
  if (tours.isError) {
    return <ErrorState what="туры" onRetry={() => void tours.refetch()} error={tours.error} />;
  }

  const hasTours = tours.data.length > 0;
  // На пустом списке форма открыта сразу и без кнопки: иначе после первого
  // тура она схлопнулась бы под фокусом.
  const formVisible = !hasTours || open;

  return (
    <section>
      <div className={hasTours ? "page__head page__head--action" : "page__head"}>
        <div>
          <h1>Туры</h1>
          {hasTours ? <p data-testid="tours-summary">{summaryLabel(tours.data)}</p> : null}
        </div>
        {hasTours ? (
          <button
            ref={toggleRef}
            type="button"
            className="btn btn--primary"
            aria-expanded={formVisible}
            aria-controls={NEW_TOUR_FORM_ID}
            onClick={() => {
              userToggled.current = true;
              setOpen(!open);
            }}
          >
            Новый тур
          </button>
        ) : null}
      </div>

      <div id={NEW_TOUR_FORM_ID} hidden={!formVisible}>
        <form
          className="projects__new"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) {
              return;
            }
            // Пустота запоминается при отправке: к ответу список уже обновлён.
            const wasEmpty = !hasTours;
            create.mutate(trimmed, {
              onSuccess: () => {
                setName("");
                // Форма на пустом списке была открыта сама; с первым туром
                // открытость становится явной, а не пропадает. Если туры уже
                // были, явное решение владельца (в том числе закрыть) не трогаем.
                if (wasEmpty) {
                  setOpen(true);
                }
              },
            });
          }}
        >
          <label htmlFor="tour-name">Название нового тура</label>
          <div className="projects__new-row">
            <input
              id="tour-name"
              ref={nameRef}
              value={name}
              maxLength={200}
              placeholder="Например: знакомство с отчётами"
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" className="btn btn--primary" disabled={create.isPending}>
              {create.isPending ? "Создаём…" : "Создать"}
            </button>
          </div>
          {create.isError ? <p role="alert">Не удалось создать тур.</p> : null}
        </form>
      </div>

      {!hasTours ? (
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

function completionPercent(tour: TourListItem): number {
  return Math.round(tour.completion_rate_7d * 100);
}

export function completionLabel(tour: TourListItem): string {
  if (tour.runs_7d === 0) {
    // «0 %» при нуле запусков — не ноль, а отсутствие данных.
    return "—";
  }
  return `${completionPercent(tour)} %`;
}

/**
 * Сводка по загруженному списку. Честна, пока список отдаётся целиком:
 * `list_with_metrics` без `LIMIT`, а число туров ограничено продуктовым
 * лимитом «50 туров на проект» (§5 docs/data-model.md). Запуски черновиков
 * входят в сумму: они были до снятия с публикации.
 */
export function summaryLabel(tours: TourListItem[]): string {
  const published = tours.filter((tour) => tour.status === "published").length;
  const runs = tours.reduce((sum, tour) => sum + tour.runs_7d, 0);
  return [
    plural(tours.length, ["тур", "тура", "туров"]),
    plural(published, ["опубликован", "опубликованы", "опубликовано"]),
    `${plural(runs, ["запуск", "запуска", "запусков"])} за 7 дней`,
  ].join(" · ");
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
            <button type="button" className="btn btn--danger" onClick={() => remove.mutate(tour.id)}>
              Удалить
            </button>{" "}
            <button type="button" className="btn btn--quiet" onClick={() => setConfirming(false)}>
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
      <td className="table__number">
        {completionLabel(tour)}
        {tour.runs_7d === 0 ? null : (
          <span className="completion__bar" data-testid="completion-bar" aria-hidden="true">
            <span
              className="completion__fill"
              data-testid="completion-fill"
              style={{ width: `${completionPercent(tour)}%` }}
            />
          </span>
        )}
      </td>
      <td className="table__actions">
        <Link className="btn" to={`/projects/${projectId}/tours/${tour.id}`}>Открыть</Link>
        <RowMenu label={`Ещё: ${tour.name}`}>
          <Link className="btn" to={`/projects/${projectId}/tours/${tour.id}/analytics`}>Аналитика</Link>
          <button
            type="button"
            className="btn"
            disabled={publication.isPending || blocked}
            // Публикация тура без шагов отклоняется сервером (422), но кнопку
            // лучше выключить заранее и сказать почему, чем показать ошибку.
            title={blocked ? "Сначала добавьте хотя бы один шаг в конструкторе" : undefined}
            onClick={() => publication.mutate({ id: tour.id, published: !published })}
          >
            {published ? "Снять с публикации" : "Опубликовать"}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
            Удалить
          </button>
        </RowMenu>
      </td>
    </tr>
  );
}
