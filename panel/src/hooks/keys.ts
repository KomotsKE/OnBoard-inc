/**
 * Ключи запросов — в одном месте.
 *
 * От общего к частному, как договорено в §4.6 docs/vision.md. Общий модуль
 * нужен и затем, чтобы хуки списка и хуки одной записи могли инвалидировать
 * друг друга, не импортируя друг друга по кругу.
 */

export const projectsKey = ["projects"] as const;
export const projectKey = (projectId: string) => ["project", projectId] as const;
export const snippetKey = (projectId: string) => ["snippet", projectId] as const;
export const toursKey = (projectId: string) => ["tours", projectId] as const;
export const tourKey = (tourId: string) => ["tour", tourId] as const;
