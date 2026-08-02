import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "artifacts/admin/src/components/schedules/BranchRoomFields.tsx"),
  "utf8",
);

test("Schedule Branch and Room fields do not require a FormField context", () => {
  assert.doesNotMatch(source, /\bFormLabel\b|\bFormMessage\b/);
  assert.match(source, /<Label htmlFor="select-schedule-branch">/);
  assert.match(source, /<Label htmlFor="select-schedule-room">/);
});

test("Schedule location validation remains visible and accessible", () => {
  assert.match(source, /id="schedule-branch-error" role="alert"/);
  assert.match(source, /id="schedule-room-error" role="alert"/);
  assert.match(source, /aria-invalid=\{Boolean\(branchError\)\}/);
  assert.match(source, /aria-invalid=\{Boolean\(roomError\)\}/);
});
