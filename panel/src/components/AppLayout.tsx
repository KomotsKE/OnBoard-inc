import { Link, Outlet } from "react-router-dom";

/**
 * Общая рамка приватных экранов. Переключатель проектов, email владельца и
 * выход появятся здесь в T3.1 и T3.2 — сейчас только навигационная рамка.
 */
export function AppLayout() {
  return (
    <>
      <header>
        <Link to="/projects">OnBoard</Link>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
