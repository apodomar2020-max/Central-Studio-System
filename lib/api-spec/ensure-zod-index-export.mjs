import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_LINE = "export * from './generated/api';";

export function ensureGeneratedExport(content) {
  if (content.split("\n").some((line) => line.trim() === REQUIRED_LINE)) return content;
  return `${REQUIRED_LINE}\n${content}`;
}

function main() {
  const indexPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "api-zod",
    "src",
    "index.ts",
  );
  const current = readFileSync(indexPath, "utf8");
  const next = ensureGeneratedExport(current);
  if (next !== current) writeFileSync(indexPath, next);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
