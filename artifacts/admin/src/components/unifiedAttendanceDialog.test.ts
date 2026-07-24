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

test("Record Walk-in is always offered per account — never gated on hasEligible (Blocker B)", () => {
  // The old, incorrect gate hid Walk-in for the WHOLE account whenever any
  // one candidate (any participant, any class) was eligible. The button must
  // now render unconditionally per account; only its copy may vary.
  assert.doesNotMatch(source, /\{!hasEligible\s*&&\s*\(/);
  assert.match(source, /onClick=\{\(\) => void startWalkIn\(account\)\}/);
  // hasEligible may still exist (it now only toggles copy), but must not gate
  // whether the Record Walk-in button itself is rendered.
  const walkInBlockMatch = /<div className="rounded-xl p-3 flex items-center justify-between gap-3"[\s\S]*?Record Walk-in[\s\S]*?<\/div>\s*<\/div>/.exec(source);
  assert.ok(walkInBlockMatch, "expected an unconditional Record Walk-in block");
});

test("Walk-in never auto-selects a participant, option, or payment decision", () => {
  assert.doesNotMatch(source, /setWalkInParticipant\([^)]*\[0\]/);
  assert.doesNotMatch(source, /setWalkInSelectedOption\([^)]*\[0\]/);
  assert.match(source, /function pickWalkInParticipant\(participant: WalkInParticipant\)/);
  assert.match(source, /function pickWalkInOption\(option: WalkInOption\)/);
});
