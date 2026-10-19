/** Хуки списка туров (S7 docs/screens.md). */

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  createTour,
  deleteTour,
  listTours,
  publishTour,
  type TourListItem,
} from "../api/tours";
import { projectsKey } from "./useProjects";

export const toursKey = (projectId: string) => ["tours", projectId] as const;

/**
 * Сначала отмена, потом инвалидация — иначе запрос, запущенный предыдущей
 * мутацией, перезапишет кэш состоянием до неё (§5 docs/conventions.md).
 *
 * Список проектов тоже освежается: число туров в карточке меняется вместе
 * с этим списком.
 */
async function refreshTours(queryClient: QueryClient, projectId: string): Promise<void> {
  await queryClient.cancelQueries({ queryKey: toursKey(projectId) });
  await queryClient.invalidateQueries({ queryKey: toursKey(projectId) });
  await queryClient.invalidateQueries({ queryKey: projectsKey });
}

export function useTours(projectId: string) {
  return useQuery<TourListItem[]>({
    queryKey: toursKey(projectId),
    queryFn: ({ signal }) => listTours(projectId, signal),
  });
}

export function useCreateTour(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createTour(projectId, name),
    onSuccess: () => refreshTours(queryClient, projectId),
  });
}

export function useTourPublication(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      publishTour(id, published),
    onSuccess: () => refreshTours(queryClient, projectId),
  });
}

export function useDeleteTour(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTour,
    onSuccess: () => refreshTours(queryClient, projectId),
  });
}
