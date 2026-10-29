import type { ReactNode } from "react";

/**
 * Скелет вместо текста «Загружаем…». Форма повторяет экран, который придёт
 * на смену: теми же классами и теми же размерами ячеек. Если скелет ниже или
 * уже настоящего содержимого, страница при появлении данных прыгает.
 *
 * Декоративная часть скрыта от скринридера (`aria-hidden`), контейнер помечен
 * `aria-busy`, а о происходящем сообщает один скрытый статус.
 */

export type SkeletonShape =
  | "projects"
  | "tours"
  | "analytics"
  | "builder"
  | "branding"
  | "install";

/*
 * Размеры сняты с живого экрана (высота строки текста, поля, кнопки в браузере
 * при размере шрифта панели), а не посчитаны: скелет обязан совпасть с ними,
 * иначе страница прыгает. Имена нужны только тем, что встречаются дважды и
 * больше; остальные числа в разметке — того же происхождения, и пересчитывать
 * их нужно вместе с экраном, который они повторяют.
 */
const BUTTON_HEIGHT = "40px";
const INPUT_HEIGHT = "40px";
const LABEL_HEIGHT = "20px";
const HINT_HEIGHT = "19px";
const FORM_HINT_HEIGHT = "170px";
const TEXTAREA_HEIGHT = "84px";
const STEP_LIST_HEIGHT = "200px";
const PREVIEW_HEIGHT = "200px";
const ORIGINS_HEIGHT = "200px";
const BRANDING_FIELDS = 8;
const TILES = 4;
const FUNNEL_ROWS = 5;
const TOUR_HEADERS = ["Тур", "Где показывается", "Шагов", "Запусков 7д", "Завершение"];

function Bone({ width = "100%", height = "1.2em" }: { width?: string; height?: string }) {
  return <span className="bone" style={{ width, height }} />;
}

function Heading({ width }: { width: string }) {
  return (
    <div className="page__head">
      <h1>
        <Bone width={width} />
      </h1>
    </div>
  );
}

function NewItemForm() {
  return (
    <div className="projects__new">
      <Bone width="12rem" height="16px" />
      <div className="projects__new-row">
        <Bone height={BUTTON_HEIGHT} />
        <Bone width="96px" height={BUTTON_HEIGHT} />
      </div>
    </div>
  );
}

function Field({ tall = false }: { tall?: boolean }) {
  return (
    <>
      <Bone width="40%" height={LABEL_HEIGHT} />
      <Bone height={tall ? TEXTAREA_HEIGHT : INPUT_HEIGHT} />
    </>
  );
}

function BuilderBody() {
  return (
    <section className="builder">
      <div className="builder__head">
        <div className="builder__about">
          <p className="builder__back">
            <Bone width="9rem" />
          </p>
          <h1>
            <Bone width="16rem" />
          </h1>
          <p>
            <Bone width="12rem" />
          </p>
        </div>
        <Bone width="160px" height={BUTTON_HEIGHT} />
      </div>

      <div className="install__block">
        <h2>
          <Bone width="10rem" />
        </h2>
        <div className="projects__new-row">
          <Bone width="96px" height={BUTTON_HEIGHT} />
          <Bone height={BUTTON_HEIGHT} />
          <Bone width="120px" height={BUTTON_HEIGHT} />
        </div>
      </div>

      <div className="builder__grid">
        <div className="builder__col">
          <h2>
            <Bone width="5rem" />
          </h2>
          <Bone height={STEP_LIST_HEIGHT} />
        </div>
        <div className="builder__col">
          <h2>
            <Bone width="5rem" />
          </h2>
          <div className="step-form">
            <Field />
            <Bone height={FORM_HINT_HEIGHT} />
            <Field />
            <Field tall />
            <Field />
            <div className="projects__new-row step-form__actions">
              <Bone width="120px" height={BUTTON_HEIGHT} />
              <Bone width="120px" height={BUTTON_HEIGHT} />
            </div>
          </div>
        </div>
        <div className="builder__col">
          <Bone height={PREVIEW_HEIGHT} />
        </div>
      </div>
    </section>
  );
}

function BrandingBody() {
  return (
    <section className="branding page">
      <div className="page__head">
        <p>
          <Bone width="6rem" />
        </p>
        <h1>
          <Bone width="12rem" />
        </h1>
        <p>
          <Bone width="70%" />
        </p>
      </div>
      <div className="split">
        <div className="step-form">
          {Array.from({ length: BRANDING_FIELDS }, (_, key) => (
            <Field key={key} />
          ))}
          <Bone height={HINT_HEIGHT} />
          <Bone width="60%" height={HINT_HEIGHT} />
          <div className="projects__new-row step-form__actions">
            <Bone width="120px" height={BUTTON_HEIGHT} />
          </div>
        </div>
        <div>
          <Bone height={PREVIEW_HEIGHT} />
          <Bone height={HINT_HEIGHT} />
          <Bone width="80%" height={HINT_HEIGHT} />
        </div>
      </div>
    </section>
  );
}

function InstallBody() {
  return (
    <section className="install page">
      <div className="page__head">
        <h1>
          <Bone width="16rem" />
        </h1>
        <p>
          <Bone />
        </p>
      </div>
      <div className="banner">
        <Bone height={HINT_HEIGHT} />
      </div>
      <SnippetBlock />
      <div className="split">
        <div className="install__block">
          <h2>
            <Bone width="12rem" />
          </h2>
          <Bone height={ORIGINS_HEIGHT} />
        </div>
        <div className="install__block">
          <Bone width="80%" height={HINT_HEIGHT} />
        </div>
      </div>
    </section>
  );
}

function ProjectsBody() {
  return (
    <>
      <Heading width="10rem" />
      <NewItemForm />
      <ul className="projects">
        {[0, 1, 2].map((key) => (
          <li key={key} className="projects__card">
            <div className="projects__row">
              <div className="projects__about skeleton__about">
                <h2>
                  <Bone width="40%" />
                </h2>
                <Bone width="70%" height="17px" />
                <Bone width="55%" height="15px" />
              </div>
              <div className="projects__links">
                {[0, 1, 2].map((button) => (
                  <Bone key={button} width="96px" height={BUTTON_HEIGHT} />
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function ToursBody() {
  return (
    <>
      <Heading width="8rem" />
      <NewItemForm />
      <div className="table">
        <table>
          <thead>
            <tr>
              {TOUR_HEADERS.map((title, index) => (
                <th key={title} className={index > 1 ? "table__number" : undefined}>
                  {title}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3].map((key) => (
              <tr key={key}>
                <td>
                  <Bone width="70%" />
                </td>
                <td>
                  <Bone width="85%" />
                </td>
                {[0, 1, 2].map((cell) => (
                  <td key={cell} className="table__number">
                    <Bone width="2rem" />
                  </td>
                ))}
                <td className="table__actions">
                  <Bone width="88px" height={BUTTON_HEIGHT} />
                  <Bone width="72px" height={BUTTON_HEIGHT} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AnalyticsBody() {
  return (
    <>
      <div className="page__head">
        <p>
          <Bone width="9rem" />
        </p>
        <h1>
          <Bone width="16rem" />
        </h1>
        <div className="funnel__range">
          <Bone width="96px" height={BUTTON_HEIGHT} />
          <Bone width="96px" height={BUTTON_HEIGHT} />
        </div>
      </div>
      <div className="totals">
        {Array.from({ length: TILES }, (_, key) => (
          <div key={key} className="totals__tile">
            <p className="totals__label">
              <Bone width="50%" />
            </p>
            <p className="totals__value">
              <Bone width="40%" />
            </p>
          </div>
        ))}
      </div>
      <div className="funnel__chart card">
        <h2>
          <Bone width="12rem" />
        </h2>
        <ol className="funnel__steps">
          {Array.from({ length: FUNNEL_ROWS }, (_, key) => (
            <li key={key} className="funnel__row">
              <Bone />
              <span className="funnel__bar">
                <span className="bone skeleton__fill" />
              </span>
              <Bone width="4rem" />
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

const BODIES: Record<SkeletonShape, () => ReactNode> = {
  projects: ProjectsBody,
  tours: ToursBody,
  analytics: AnalyticsBody,
  builder: BuilderBody,
  branding: BrandingBody,
  install: InstallBody,
};

export function Skeleton({ what, shape }: { what: string; shape: SkeletonShape }) {
  const Body = BODIES[shape];
  return (
    <div data-testid="skeleton" aria-busy="true">
      <p role="status" className="visually-hidden">
        Загружаем {what}…
      </p>
      <div aria-hidden="true">
        <Body />
      </div>
    </div>
  );
}

function SnippetBlock() {
  return (
    <div className="install__block">
      <Bone width="60%" height="19px" />
      <div className="skeleton__snippet">
        <Bone height="48px" />
      </div>
      <Bone width="120px" height={BUTTON_HEIGHT} />
    </div>
  );
}

/** Сниппет приходит отдельным запросом, позже самого проекта. */
export function SnippetSkeleton() {
  return (
    <div aria-busy="true">
      <p role="status" className="visually-hidden">
        Готовим сниппет…
      </p>
      <div aria-hidden="true">
        <SnippetBlock />
      </div>
    </div>
  );
}
