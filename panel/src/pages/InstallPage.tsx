import { useState } from "react";
import { useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { ErrorState, Loading } from "../components/States";
import { useAllowedOrigins, useProject, useSnippet } from "../hooks/useProjects";

/**
 * S5 docs/screens.md — установка виджета на сайт клиента.
 *
 * Экран отвечает не только владельцу, но и его разработчику и службе
 * безопасности: что именно добавляется на сайт, куда уходят запросы и что
 * остаётся в браузере посетителя (§3.4 docs/idea.md). Без этих ответов
 * установка упирается в согласование, а не в технику.
 */
export function InstallPage() {
  const { projectId = "" } = useParams();
  const project = useProject(projectId);
  const snippet = useSnippet(projectId);

  if (project.isPending) {
    return <Loading what="проект" />;
  }
  if (project.isError) {
    return <ErrorState what="проект" onRetry={() => void project.refetch()} error={project.error} />;
  }

  return (
    <section className="install">
      <h1>Установка виджета</h1>
      <p>
        Проект «{project.data.name}» · ключ <code>{project.data.public_key}</code>
      </p>

      <Status connected={project.data.widget_connected} />
      <Snippet text={snippet.data} failed={snippet.isError} />
      <Origins projectId={projectId} origins={project.data.allowed_origins} />
      <Technical snippet={snippet.data} />
    </section>
  );
}

function Status({ connected }: { connected: boolean }) {
  return (
    <p className="install__status" data-testid="widget-status">
      {connected
        ? "Виджет подключён: мы видели его запрос с вашего сайта."
        : "Виджет ещё не найден. Вставьте тег и откройте любую страницу сайта — статус обновится."}
    </p>
  );
}

function Snippet({ text, failed }: { text?: string; failed: boolean }) {
  const [copied, setCopied] = useState<"нет" | "да" | "ошибка">("нет");

  if (failed) {
    return <p role="alert">Не удалось получить сниппет.</p>;
  }
  if (!text) {
    return <p>Готовим сниппет…</p>;
  }

  return (
    <div className="install__block">
      <h2>Шаг 1. Вставьте тег перед закрывающим &lt;/body&gt;</h2>
      <pre data-testid="snippet">{text}</pre>
      <button
        type="button"
        onClick={() => {
          // Буфер обмена доступен не везде (нет https, запрет политикой):
          // тогда сниппет остаётся на экране и его можно выделить руками.
          navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied("да"))
            .catch(() => setCopied("ошибка"));
        }}
      >
        Скопировать
      </button>
      {copied === "да" ? <span className="install__hint">Скопировано</span> : null}
      {copied === "ошибка" ? (
        <span className="install__hint">Буфер недоступен — скопируйте выделением</span>
      ) : null}
    </div>
  );
}

function Origins({ projectId, origins }: { projectId: string; origins: string[] }) {
  const update = useAllowedOrigins(projectId);
  const [draft, setDraft] = useState("");

  const error =
    update.error instanceof ApiError
      ? (update.error.detail ?? update.error.title)
      : update.error
        ? "Не удалось сохранить список доменов"
        : null;

  return (
    <div className="install__block">
      <h2>Шаг 2. Разрешите домены</h2>
      {origins.length === 0 ? (
        <p className="install__warning" role="alert" data-testid="origins-empty">
          Пока список пуст, виджет не будет работать ни на одном домене. Так и задумано:
          публичный ключ виден в исходниках страницы, и без проверки домена им мог бы
          воспользоваться чужой сайт.
        </p>
      ) : (
        <ul className="install__origins" data-testid="origins">
          {origins.map((origin) => (
            <li key={origin}>
              <code>{origin}</code>
              <button
                type="button"
                aria-label={`Убрать ${origin}`}
                disabled={update.isPending}
                onClick={() => update.mutate(origins.filter((item) => item !== origin))}
              >
                Убрать
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="projects__new-row"
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft.trim();
          if (!value) {
            return;
          }
          update.mutate([...origins, value], { onSuccess: () => setDraft("") });
        }}
      >
        <label className="install__label" htmlFor="origin">
          Адрес сайта
        </label>
        <input
          id="origin"
          value={draft}
          placeholder="https://example.com"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={update.isPending}>
          Добавить
        </button>
      </form>
      {error ? (
        <p role="alert" data-testid="origins-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Хосты из сниппета: один отдаёт файлы виджета, второй принимает запросы. */
export function hostsFromSnippet(snippet: string): { widget: string; api: string } | null {
  const widget = /src="([^"]+)"/.exec(snippet)?.[1];
  const api = /data-api="([^"]+)"/.exec(snippet)?.[1];
  if (!widget || !api) {
    return null;
  }
  try {
    return { widget: new URL(widget).origin, api: new URL(api).origin };
  } catch {
    return null;
  }
}

function Technical({ snippet }: { snippet?: string }) {
  const hosts = snippet ? hostsFromSnippet(snippet) : null;

  return (
    <details className="install__block" data-testid="technical">
      <summary>Для вашего разработчика и службы безопасности</summary>

      <h3>Что добавить в Content-Security-Policy</h3>
      {hosts ? (
        <ul>
          <li>
            <code>script-src {hosts.widget}</code> — отсюда загружаются файлы виджета
          </li>
          <li>
            <code>connect-src {hosts.api}</code> — сюда уходят запросы виджета
          </li>
        </ul>
      ) : (
        <p>Адреса появятся вместе со сниппетом.</p>
      )}

      <h3>Сколько весит</h3>
      <p>
        Загрузчик — не больше 5 КБ в сжатом виде. Движок тура (не больше 30 КБ) скачивается
        только на страницах, где для посетителя действительно есть тур; на остальных не
        запрашивается вовсе.
      </p>

      <h3>Какие запросы уходят</h3>
      <p>
        Один запрос конфигурации на загрузку страницы и события прохождения тура — батчами.
        Больше виджет никуда не обращается: ни к сторонним доменам, ни к рекламным сетям.
      </p>

      <h3>Что остаётся в браузере посетителя</h3>
      <p>
        Ни одной cookie. В <code>localStorage</code> — только прогресс по турам под ключами
        вида <code>onboard.v1.&lt;ключ проекта&gt;.tour.&lt;id&gt;</code>. Ни IP, ни адрес
        почты, ни User-Agent посетителя мы не сохраняем.
      </p>
    </details>
  );
}
