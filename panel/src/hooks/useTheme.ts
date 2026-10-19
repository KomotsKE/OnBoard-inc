/** Тема оформления проекта (S6 docs/screens.md). */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { request } from "../api/client";
import type { Project } from "../api/projects";
import { projectKey, projectsKey } from "./keys";

function setTheme(projectId: string, theme: Project["theme"]): Promise<Project> {
  return request<Project>(`/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({ theme }),
  });
}

export function useUpdateTheme(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (theme: Project["theme"]) => setTheme(projectId, theme),
    onSuccess: async (project) => {
      // Ответ — проект целиком: экран не моргает и не ждёт перезапроса.
      queryClient.setQueryData(projectKey(projectId), project);
      await queryClient.cancelQueries({ queryKey: projectsKey });
      await queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
}
