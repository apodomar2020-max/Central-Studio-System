import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Admin deduplicates React Query so workspace hooks share the shell's context", () => {
  const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
  const dedupe = config.match(/dedupe:\s*\[([^\]]+)\]/)?.[1] ?? "";
  for (const dependency of ["react", "react-dom", "@tanstack/react-query"]) {
    assert.ok(dedupe.includes(`"${dependency}"`), `${dependency} must remain deduplicated`);
  }
});
