/** Хуки конструктора тура (S8 docs/screens.md). */

import { useEffect } from "react";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  createEditorSession,
  createStep,
  deleteStep,
  getTour,
  reorderSteps,
  updateStep,
  updateTour,
  type Step,
  type StepDraft,
  type Tour,
  type UrlMatch,
} from "../api/tours";
import { projectsKey, tourKey, toursKey } from "./keys";

export { tourKey } from "./keys";

/**
 * Конструктор меняет и сам тур, и его строку в списке, и число туров в
 * карточке проекта. Отмена перед инвалидацией — по той же причине, что и
 * везде: запрос предыдущей мутации иначе перезапишет кэш старым состоянием.
 */
async function refreshTour(
  queryClient: QueryClient,
  tourId: string,
  projectId: string,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: tourKey(tourId) });
  await queryClient.invalidateQueries({ queryKey: tourKey(tourId) });
  await queryClient.invalidateQueries({ queryKey: toursKey(projectId) });
  await queryClient.invalidateQueries({ queryKey: projectsKey });
}

export function useTour(tourId: string) {
  return useQuery<Tour>({
    queryKey: tourKey(tourId),
    queryFn: ({ signal }) => getTour(tourId, signal),
    // Шаги могут появиться из режима выбора на сайте клиента (T5.5), поэтому
    // при возврате в окно тур перезапрашивается — единственный экран, которому
    // это нужно (§4.6 docs/vision.md).
    refetchOnWindowFocus: true,
  });
}

/**
 * Открытие режима выбора элементов на сайте клиента.
 *
 * Мутация без инвалидации кэша: на сервере ничего не меняется, а шаги,
 * добавленные в соседней вкладке, подхватит `useTour` при возврате фокуса.
 */
export function useEditorSession(tourId: string) {
  return useMutation({
    mutationFn: ({ pageUrl, mode }: { pageUrl: string; mode: "edit" | "preview" }) =>
      createEditorSession(tourId, pageUrl, mode),
  });
}

/**
 * Перезапрос тура при возврате в окно панели.
 *
 * `refetchOnWindowFocus` ловит возврат на вкладку — он слушает
 * `visibilitychange`. Если панель открыта в соседнем окне, а не вкладке,
 * видимость не меняется и это событие не приходит: переключение окон видно
 * только по `focus`. Владелец, выбирающий элементы на сайте, оказывается
 * ровно в одном из этих двух положений.
 */
export function useRefreshOnFocus(tourId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = (): void => {
      void queryClient.invalidateQueries({ queryKey: tourKey(tourId) });
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [queryClient, tourId]);
}

export function useUpdateTour(tourId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { name?: string; url_match?: UrlMatch; show_once?: boolean }) =>
      updateTour(tourId, patch),
    onSuccess: (tour) => {
      queryClient.setQueryData(tourKey(tourId), tour);
      return refreshTour(queryClient, tourId, projectId);
    },
  });
}

export function useCreateStep(tourId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (step: StepDraft) => createStep(tourId, step),
    onSuccess: () => refreshTour(queryClient, tourId, projectId),
  });
}

export function useUpdateStep(tourId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<StepDraft> }) =>
      updateStep(id, patch),
    onSuccess: () => refreshTour(queryClient, tourId, projectId),
  });
}

export function useDeleteStep(tourId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteStep,
    onSuccess: () => refreshTour(queryClient, tourId, projectId),
  });
}

/**
 * Перестановка — оптимистичная.
 *
 * Порядок шагов пользователь видит немедленно: ждать ответа сервера, чтобы
 * строка встала на место, неуместно. Ошибка возвращает кэш к снимку, сделанному
 * до перетаскивания (§4.6 docs/vision.md).
 */
export function useReorderSteps(tourId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stepIds: string[]) => reorderSteps(tourId, stepIds),

    onMutate: async (stepIds) => {
      await queryClient.cancelQueries({ queryKey: tourKey(tourId) });
      const previous = queryClient.getQueryData<Tour>(tourKey(tourId));
      if (previous) {
        queryClient.setQueryData<Tour>(tourKey(tourId), {
          ...previous,
          steps: reindex(previous.steps, stepIds),
        });
      }
      return { previous };
    },

    onError: (_error, _ids, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tourKey(tourId), context.previous);
      }
    },

    onSettled: () => refreshTour(queryClient, tourId, projectId),
  });
}

/** Переставляет шаги в указанном порядке и пересчитывает позиции. */
export function reindex(steps: Step[], order: string[]): Step[] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  return order
    .map((id) => byId.get(id))
    .filter((step): step is Step => step !== undefined)
    .map((step, index) => ({ ...step, position: index }));
}
