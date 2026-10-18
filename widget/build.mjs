// Сборка трёх бандлов виджета.
//
// loader.js без хэша в имени и с коротким кэшем, ядро и редактор — с хэшем
// содержимого и вечным кэшем (ADR-0009). Точный адрес ядра публичный конфиг
// берёт из manifest.json, поэтому обновление ядра не требует правок у клиента.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const OUT = "dist";
const COMMON = {
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  logLevel: "warning",
};

async function hashOf(path) {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex").slice(0, 10);
}

async function buildHashed(name, entry) {
  const temp = `${OUT}/${name}.tmp.js`;
  await build({ ...COMMON, entryPoints: [entry], outfile: temp });
  const hash = await hashOf(temp);
  const file = `${name}.${hash}.js`;
  await writeFile(`${OUT}/${file}`, await readFile(temp));
  await rm(temp);
  return file;
}

// Каталог не удаляется, а очищается: его монтируют в стенд и в API, и удаление
// меняет inode — монтирование остаётся висеть на удалённом каталоге, после чего
// nginx отдаёт 404, а публичный конфиг не находит манифест. Проверено: именно
// так сломался первый прогон e2e.
await mkdir(OUT, { recursive: true });
for (const name of await readdir(OUT)) {
  await rm(`${OUT}/${name}`, { recursive: true, force: true });
}

await build({ ...COMMON, entryPoints: ["src/loader/index.ts"], outfile: `${OUT}/loader.js` });
const manifest = {
  core: await buildHashed("core", "src/core/index.ts"),
  editor: await buildHashed("editor", "src/editor/index.ts"),
};
await writeFile(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`собрано: loader.js, ${manifest.core}, ${manifest.editor}`);
