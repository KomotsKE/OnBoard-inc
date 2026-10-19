/**
 * Хуки списка проектов. Компоненты не знают ни про `fetch`, ни про ключи
 * кэша — только про данные (§5 docs/conventions.md).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createProject, deleteProject, listProjects, type Project } from "../api/projects";

/** Ключ из контракта экранов (S4 docs/screens.md). */
export const projectsKey = ["projects"] as const;

export function useProjects() {
  // Сигнал отмены передаётся дальше в fetch: иначе отменить запрос нечем.
  return useQuery<Project[]>({
    queryKey: projectsKey,
    queryFn: ({ signal }) => listProjects(signal),
  });
}

/**
 * Перечитать список после изменения.
 *
 * Сначала отмена, потом инвалидация. Без отмены запрос, запущенный предыдущей
 * мутацией, может быть ещё в полёте: новая инвалидация переиспользует его, а
 * его ответ — снимок состояния до нашего изменения. На глазах у пользователя
 * это выглядит так: создал два проекта подряд, второй не появился. Поймано
 * сценарием e2e, а не рассуждением.
 *
 * Инвалидация по ключу, а не сброс всего кэша: остальные данные владельца
 * от появления проекта не устарели.
 */
async function refreshProjects(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await queryClient.cancelQueries({ queryKey: projectsKey });
  await queryClient.invalidateQueries({ queryKey: projectsKey });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => refreshProjects(queryClient),
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: () => refreshProjects(queryClient),
  });
}
