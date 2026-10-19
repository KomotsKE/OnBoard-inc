/** Воронка тура (S9 docs/screens.md). */

import { request } from "./client";

export type AnalyticsRange = "7d" | "30d";

export type Totals = {
  runs: number;
  completed: number;
  skipped: number;
  /** Запуски минус завершения минус скипы: закрыл вкладку. */
  dropped: number;
  completion_rate: number;
  skip_rate: number;
};

export type FunnelStep = {
  step_position: number;
  step_id: string | null;
  title: string;
  selector: string;
  runs: number;
  rate: number;
  drop_off: number;
};

export type Issue = {
  type: "step_target_missing" | "widget_error";
  step_position: number | null;
  selector: string | null;
  error_code: string | null;
  count: number;
};

export type TourAnalytics = {
  range: AnalyticsRange;
  since: string;
  totals: Totals;
  funnel: FunnelStep[];
  problem_step: number | null;
  issues: Issue[];
};

export function getAnalytics(
  tourId: string,
  range: AnalyticsRange,
  signal?: AbortSignal,
): Promise<TourAnalytics> {
  return request<TourAnalytics>(`/tours/${tourId}/analytics?range=${range}`, { signal });
}
