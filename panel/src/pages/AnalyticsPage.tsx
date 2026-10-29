import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { AnalyticsRange, FunnelStep, Issue, TourAnalytics } from "../api/analytics";
import { Empty, ErrorState, Loading } from "../components/States";
import { useAnalytics } from "../hooks/useAnalytics";
import { useTour } from "../hooks/useTour";
import { plural } from "../text";

/**
 * S9 docs/screens.md — воронка тура.
 *
 * Форма выбрана по задаче данных: величина по шагам в заданном порядке —
 * это горизонтальные столбцы (длинные названия шагов в вертикальных не
 * помещаются), а тоталы — числа, а не график. Ряд один, поэтому легенда не
 * нужна: заголовок называет его сам.
 */
export function AnalyticsPage() {
  const { projectId = "", tourId = "" } = useParams();
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const tour = useTour(tourId);
  const analytics = useAnalytics(tourId, range);

  if (analytics.isPending) {
    return <Loading what="воронку" shape="analytics" />;
  }
  if (analytics.isError) {
    return <ErrorState what="воронку" onRetry={() => void analytics.refetch()} error={analytics.error} />;
  }

  return (
    <section className="funnel">
      <div className="page__head">
        <p>
          <Link to={`/projects/${projectId}/tours/${tourId}`}>← К конструктору</Link>
        </p>
        <h1>{tour.data?.name ?? "Воронка"}</h1>
        <div className="funnel__range" role="group" aria-label="Период">
          {(["7d", "30d"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="btn"
              aria-pressed={range === value}
              data-testid={`range-${value}`}
              onClick={() => setRange(value)}
            >
              {value === "7d" ? "7 дней" : "30 дней"}
            </button>
          ))}
        </div>
      </div>

      {analytics.data.totals.runs === 0 ? (
        <NoRuns />
      ) : (
        <>
          <Totals data={analytics.data} />
          <FunnelWithIssues data={analytics.data} />
        </>
      )}
    </section>
  );
}

function NoRuns() {
  return (
    <Empty testId="funnel-empty">
      Тур ещё не запускали. Проверьте, что он опубликован, а условие показа совпадает
      с адресом страницы — и что виджет установлен на сайте.
    </Empty>
  );
}

function Totals({ data }: { data: TourAnalytics }) {
  const { totals } = data;
  const tiles = [
    { label: "Запусков", value: String(totals.runs), share: null },
    { label: "Завершили", value: String(totals.completed), share: totals.completion_rate },
    { label: "Пропустили", value: String(totals.skipped), share: totals.skip_rate },
    {
      label: "Бросили",
      value: String(totals.dropped),
      share: totals.runs ? totals.dropped / totals.runs : 0,
    },
  ];

  return (
    <div className="totals" data-testid="totals">
      {tiles.map((tile) => (
        <div key={tile.label} className="totals__tile">
          <p className="totals__label">{tile.label}</p>
          <p className="totals__value">
            {tile.value}
            {tile.share === null ? null : (
              <span className="totals__share"> {percent(tile.share)}</span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

function FunnelWithIssues({ data }: { data: TourAnalytics }) {
  if (data.issues.length === 0) {
    return <Funnel data={data} />;
  }
  return (
    <div className="split" data-testid="analytics-split">
      <Funnel data={data} />
      <Issues issues={data.issues} />
    </div>
  );
}

function Funnel({ data }: { data: TourAnalytics }) {
  return (
    <div className="funnel__chart card">
      <h2>Воронка по шагам</h2>
      <ol className="funnel__steps" data-testid="funnel">
        {data.funnel.map((step) => (
          <FunnelRow
            key={step.step_position}
            step={step}
            problem={step.step_position === data.problem_step}
          />
        ))}
        <li className="funnel__row funnel__row--finish">
          <span className="funnel__name">Завершили</span>
          <span className="funnel__bar" aria-hidden="true">
            <span
              className="funnel__fill funnel__fill--finish"
              style={{ width: `${Math.round(data.totals.completion_rate * 100)}%` }}
            />
          </span>
          <span className="funnel__value">
            {data.totals.completed} · {percent(data.totals.completion_rate)}
          </span>
        </li>
      </ol>
    </div>
  );
}

function FunnelRow({ step, problem }: { step: FunnelStep; problem: boolean }) {
  return (
    <li className={problem ? "funnel__row funnel__row--problem" : "funnel__row"}>
      <span className="funnel__name" title={step.selector}>
        {step.step_position + 1}. {step.title}
      </span>
      {/* Столбец — украшение: все числа рядом словами и цифрами, поэтому
          смысл не держится на цвете. */}
      <span className="funnel__bar" aria-hidden="true">
        <span
          className={problem ? "funnel__fill funnel__fill--problem" : "funnel__fill"}
          style={{ width: `${Math.round(step.rate * 100)}%` }}
        />
      </span>
      <span className="funnel__value" title={`Потеря к следующему шагу: ${percent(step.drop_off)}`}>
        {step.runs} · {percent(step.rate)}
      </span>
      {problem ? (
        <span className="funnel__flag" data-testid="problem-step">
          ⚠ Здесь теряется больше всего: {percent(step.drop_off)} дошедших
        </span>
      ) : null}
    </li>
  );
}

function Issues({ issues }: { issues: Issue[] }) {
  return (
    <div className="funnel__issues card">
      <h2>Проблемы</h2>
      <ul data-testid="issues">
        {issues.map((issue, index) => (
          <li key={`${issue.type}-${issue.step_position}-${index}`}>{issueLabel(issue)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Проблема словами: что сломалось, где и сколько раз. */
export function issueLabel(issue: Issue): string {
  const times = plural(issue.count, ["раз", "раза", "раз"]);
  if (issue.type === "step_target_missing") {
    const step = issue.step_position === null ? "Шаг" : `Шаг ${issue.step_position + 1}`;
    const selector = issue.selector ? ` (селектор ${issue.selector})` : "";
    return `${step}: элемент не найден — ${times}${selector}`;
  }
  return `Ошибка виджета${issue.error_code ? ` «${issue.error_code}»` : ""} — ${times}`;
}

export function percent(share: number): string {
  return `${Math.round(share * 100)} %`;
}
