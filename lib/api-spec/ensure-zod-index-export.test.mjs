// Proves the codegen index-export step (Phase 3 repair) is non-destructive
// and idempotent — the exact properties that made the old
// `echo ... > index.ts` step dangerous.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureGeneratedExport, REQUIRED_LINE } from "./ensure-zod-index-export.mjs";

const MANUAL_EXPORTS = [
  "export * from './ballet';",
  "export * from './balletCancellation';",
  "export * from './permissions';",
  "export * from './qr-attendance';",
].join("\n");

test("existing manual exports survive when the generated export is already present", () => {
  const before = `${REQUIRED_LINE}\n${MANUAL_EXPORTS}\n`;
  const after = ensureGeneratedExport(before);
  assert.equal(after, before);
  for (const line of MANUAL_EXPORTS.split("\n")) {
    assert.match(after, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("a missing generated export is added exactly once, without disturbing existing exports", () => {
  const before = `${MANUAL_EXPORTS}\n`;
  const after = ensureGeneratedExport(before);
  assert.equal(after, `${REQUIRED_LINE}\n${before}`);
  const occurrences = after.split("\n").filter((line) => line.trim() === REQUIRED_LINE).length;
  assert.equal(occurrences, 1);
  for (const line of MANUAL_EXPORTS.split("\n")) {
    assert.match(after, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("running the transform repeatedly never duplicates the generated export", () => {
  let content = `${MANUAL_EXPORTS}\n`;
  content = ensureGeneratedExport(content);
  content = ensureGeneratedExport(content);
  content = ensureGeneratedExport(content);
  const occurrences = content.split("\n").filter((line) => line.trim() === REQUIRED_LINE).length;
  assert.equal(occurrences, 1);
});

test("ordering and formatting are stable — no manual export line is ever reordered or rewritten", () => {
  const before = `${REQUIRED_LINE}\n${MANUAL_EXPORTS}\n`;
  const after1 = ensureGeneratedExport(before);
  const after2 = ensureGeneratedExport(after1);
  assert.equal(after1, before);
  assert.equal(after2, before);
});
