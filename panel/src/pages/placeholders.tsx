/**
 * Пустые экраны каркаса. Каждый заполняется в своей задаче — ссылки указаны
 * в тексте, чтобы по экрану было видно, когда он оживёт (§10 docs/screens.md).
 */

type Props = { title: string; task: string };

function Placeholder({ title, task }: Props) {
  return (
    <section>
      <h1>{title}</h1>
      <p>Экран появится в задаче {task} — см. docs/screens.md.</p>
    </section>
  );
}

export const LoginPage = () => <Placeholder title="Вход" task="T3.1" />;
export const RegisterPage = () => <Placeholder title="Регистрация" task="T3.1" />;
export const ProjectsPage = () => <Placeholder title="Проекты" task="T3.2" />;
export const InstallPage = () => <Placeholder title="Установка виджета" task="T3.3" />;
export const ToursPage = () => <Placeholder title="Туры" task="T3.4" />;
export const TourBuilderPage = () => <Placeholder title="Конструктор тура" task="T3.5" />;
export const AnalyticsPage = () => <Placeholder title="Аналитика" task="T4.4" />;
export const BrandingPage = () => <Placeholder title="Оформление" task="T6.2" />;

export const NotFoundPage = () => (
  <section>
    <h1>Не найдено</h1>
    <p>
      Страница не существует или не принадлежит вам: API отвечает 404 в обоих случаях
      и не различает их (ADR-0006).
    </p>
  </section>
);
