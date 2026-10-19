/** Хук экрана воронки (S9 docs/screens.md). */

import { useQuery } from "@tanstack/react-query";

import { getAnalytics, type AnalyticsRange, type TourAnalytics } from "../api/analytics";

export const analyticsKey = (tourId: string, range: AnalyticsRange) =>
  ["analytics", tourId, range] as const;

export function useAnalytics(tourId: string, range: AnalyticsRange) {
  return useQuery<TourAnalytics>({
    queryKey: analyticsKey(tourId, range),
    queryFn: ({ signal }) => getAnalytics(tourId, range, signal),
    // Цифры меняются сами по себе, пока владелец смотрит на экран.
    staleTime: 30 * 1000,
  });
}
