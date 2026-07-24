// Non-destructive replacement for the old `echo ... > index.ts` codegen
// step, which OVERWROTE lib/api-zod/src/index.ts on every codegen run,
// deleting its hand-written exports (ballet.ts, balletCancellation.ts,
// permissions.ts, qr-attendance.ts). This script only ensures the generated
// re-export line is present — it never truncates or rewrites the rest of
// the file.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_LINE = "export * from './generated/api';";

/**
 * Pure transform, no I/O — exported so it can be unit tested directly
 * without touching the real file. Idempotent: running it twice on its own
 * output is a no-op (returns the exact same string), and it never touches
 * any line other than possibly prepending the one required line.
 */
export function ensureGeneratedExport(content) {
  const alreadyPresent = content.split("\n").some((line) => line.trim() === REQUIRED_LINE);
  if (alreadyPresent) return content;
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
  if (next === current) {
    console.log("api-zod/src/index.ts already exports generated/api — nothing to do.");
  } else {
    writeFileSync(indexPath, next);
    console.log("Added missing generated/api re-export to api-zod/src/index.ts.");
  }
}

// Only run as a CLI script, not when imported for testing.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
