/**
 * Хуки списка проектов. Компоненты не знают ни про `fetch`, ни про ключи
 * кэша — только про данные (§5 docs/conventions.md).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createProject,
  deleteProject,
  getProject,
  getSnippet,
  listProjects,
  setAllowedOrigins,
  type Project,
} from "../api/projects";

/** Ключи из контракта экранов (S4, S5 docs/screens.md): от общего к частному. */
export const projectsKey = ["projects"] as const;
export const projectKey = (id: string) => ["project", id] as const;
export const snippetKey = (id: string) => ["snippet", id] as const;

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

export function useProject(id: string) {
  return useQuery<Project>({
    queryKey: projectKey(id),
    queryFn: ({ signal }) => getProject(id, signal),
  });
}

export function useSnippet(id: string) {
  return useQuery<string>({
    queryKey: snippetKey(id),
    // Сниппет меняется только вместе с адресами сервиса, то есть при переезде:
    // перечитывать его на каждом открытии экрана незачем.
    staleTime: 10 * 60 * 1000,
    queryFn: ({ signal }) => getSnippet(id, signal),
  });
}

export function useAllowedOrigins(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (origins: string[]) => setAllowedOrigins(id, origins),
    onSuccess: async (project) => {
      // Ответ PATCH — это уже новое состояние проекта: кладём его в кэш,
      // чтобы экран не моргал, и отдельно освежаем список.
      queryClient.setQueryData(projectKey(id), project);
      await refreshProjects(queryClient);
    },
  });
}
