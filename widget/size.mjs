// Проверка бюджета размера (инвариант №5, ADR-0001).
//
// Своя проверка вместо size-limit: нужно сравнить gzip-размер трёх файлов
// с порогами и внятно сообщить, что именно не влезло. Пакет с плагинами
// ради двадцати строк в согласованный набор зависимостей не тащим.

import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const KB = 1024;

// Потолки — инвариант №5. Ориентир ядра (25 КБ) измерен у Userflow:
// §3.1 docs/competitors.md.
const BUDGETS = [
  { match: /^loader\.js$/, name: "loader.js", limit: 5 * KB },
  { match: /^core\.[a-f0-9]+\.js$/, name: "core.js", limit: 30 * KB, target: 25 * KB },
  { match: /^editor\.[a-f0-9]+\.js$/, name: "editor.js", limit: 20 * KB },
];

const files = await readdir("dist");
let failed = false;

for (const budget of BUDGETS) {
  const file = files.find((candidate) => budget.match.test(candidate));
  if (!file) {
    console.error(`✗ ${budget.name}: файл не найден в dist/`);
    failed = true;
    continue;
  }

  const gzip = gzipSync(await readFile(`dist/${file}`), { level: 9 }).length;
  const percent = Math.round((gzip / budget.limit) * 100);
  const over = gzip > budget.limit;
  const aboveTarget = budget.target !== undefined && gzip > budget.target;

  const mark = over ? "✗" : aboveTarget ? "!" : "✓";
  const note = over
    ? `превышен потолок ${(budget.limit / KB).toFixed(0)} КБ`
    : aboveTarget
      ? `выше ориентира ${(budget.target / KB).toFixed(0)} КБ, но в потолке`
      : "";

  console.log(
    `${mark} ${budget.name.padEnd(12)} ${(gzip / KB).toFixed(1).padStart(6)} КБ gzip` +
      ` из ${(budget.limit / KB).toFixed(0)} КБ (${percent} %) ${note}`,
  );
  failed ||= over;
}

if (failed) {
  console.error("\nбюджет размера виджета превышен — инвариант №5");
  process.exit(1);
}
