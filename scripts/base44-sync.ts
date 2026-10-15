// Kopierer den fælles logik fra app/lib til base44/shared/preorder, så
// Base44-funktionerne (Deno) bruger præcis samme kode som resten af appen.
//
//   npm run base44:sync          skriv kopierne
//   npm run base44:sync -- --check  fejl, hvis kopierne ikke er opdaterede
//
// Deno kræver filendelsen i relative imports ("./money.ts"), og operations.ts
// ligger i samme mappe i kopien. Ret aldrig i kopierne — ret i app/lib og kør
// scriptet igen.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

export const SOURCES = [
  "app/lib/preorder/money.ts",
  "app/lib/preorder/dates.ts",
  "app/lib/preorder/charge.ts",
  "app/lib/preorder/cancel.ts",
  "app/lib/preorder/cancelService.ts",
  "app/lib/preorder/sellingPlan.ts",
  "app/lib/preorder/catalog.ts",
  "app/lib/shopify/operations.ts",
];
export const TARGET_DIR = "base44/shared/preorder";
const HEADER = "// KOPI — genereret af scripts/base44-sync.ts. Ret i app/lib, ikke her.\n";

export function toDeno(source: string): string {
  return (
    HEADER +
    source
      .replace(/from "\.\.\/shopify\/operations"/g, 'from "./operations.ts"')
      .replace(/from "\.\/([A-Za-z]+)"/g, 'from "./$1.ts"')
  );
}

function main() {
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const src of SOURCES) {
    const target = `${TARGET_DIR}/${basename(src)}`;
    const wanted = toDeno(readFileSync(src, "utf8"));
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current === wanted) continue;
    if (check) stale.push(target);
    else writeFileSync(target, wanted);
  }
  if (stale.length > 0) {
    console.error(`Forældede kopier — kør npm run base44:sync:\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  console.log(check ? "Base44-kopierne er opdaterede." : `Skrev ${TARGET_DIR}`);
}

// Kør kun, når scriptet startes direkte (ikke når testen importerer det).
if (process.argv[1]?.endsWith("base44-sync.ts")) main();
