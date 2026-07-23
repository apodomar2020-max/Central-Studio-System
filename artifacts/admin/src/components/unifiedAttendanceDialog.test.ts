import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./unified-attendance-dialog.tsx", import.meta.url), "utf8");

test("Ballet confirmation submits identity only and never client-controlled occurrence business fields", () => {
  assert.match(source, /body\.balletLevelAssignmentId\s*=\s*candidate\.balletLevelAssignmentId/);
  assert.match(source, /body\.balletScheduleId\s*=\s*candidate\.scheduleId/);
  assert.doesNotMatch(source, /body\.(?:status|occurrenceDate|classDate|durationMinutes)\s*=/);
});

test("resolver results require an explicit candidate pick before confirmation", () => {
  assert.match(source, /function pickCandidate\(account: AccountGroup, candidate: Candidate\)/);
  assert.match(source, /if \(!selected\) return;/);
  assert.doesNotMatch(source, /setSelected\([^\n]*candidates\[0\]/);
});
