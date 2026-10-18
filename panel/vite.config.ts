import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Конфиг исполняется в Node. Объявление вместо @types/node: единственное, что
// нужно отсюда, — одна переменная окружения, и это не повод тащить пакет типов
// в согласованный набор зависимостей. Появится больше Node-API — добавим пакет.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Прокси на API: в разработке панель и бэкенд оказываются на одном origin,
    // поэтому httpOnly cookie с refresh-токеном работает без CORS (ADR-0008).
    proxy: {
      "/v1": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
