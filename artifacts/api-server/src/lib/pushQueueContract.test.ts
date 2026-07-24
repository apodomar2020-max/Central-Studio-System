/**
 * Source-invariant checks proving every performBookingCheckIn caller honors
 * the post-commit push-dispatch contract: the returned pendingPushJobs queue
 * must be flushed via flushPushQueue(), and that flush must happen after the
 * enclosing db.transaction() has resolved — never inside it, never ignored.
 * A caller that violates this can send a push for a write that later rolled
 * back, or (in tests) race a still-in-flight push against pool teardown.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(relativeToThisFile: string): string {
  return readFileSync(new URL(relativeToThisFile, import.meta.url), "utf8");
}

// Every known runtime caller of performBookingCheckIn, repo-wide (verified
// via `grep -rn "performBookingCheckIn(" artifacts/api-server/src`).
const CALLERS = [
  { label: "checkIn.ts (QR)", path: "../routes/checkIn.ts" },
  { label: "attendance.ts (booking-based manual check-in)", path: "../routes/attendance.ts" },
  { label: "adminAttendanceGateway.ts (studio confirm)", path: "../routes/adminAttendanceGateway.ts" },
  { label: "studioWalkIn.ts (performStudioWalkInCheckIn)", path: "./studioWalkIn.ts" },
];

test("checkInService.ts always collects a pendingPushJobs queue and threads it into every createStudentNotification call", () => {
  const source = read("./checkInService.ts");
  assert.match(source, /const pendingPushJobs: PendingPushJob\[\] = \[\];/);
  const pushQueueUses = source.match(/pushQueue: pendingPushJobs,/g) ?? [];
  assert.equal(pushQueueUses.length, 3, "expected all 3 createStudentNotification calls (checked-in, credit-used, credits-exhausted) to pass pushQueue");
  assert.match(source, /pendingPushJobs,\s*\n\s*\};/, "performBookingCheckIn must return pendingPushJobs to the caller");
});

for (const caller of CALLERS) {
  test(`${caller.label} flushes the push queue exactly once, and only after its transaction resolves`, () => {
    const source = read(caller.path);
    assert.match(source, /import \{ flushPushQueue \}/, `${caller.label} must import flushPushQueue`);
    assert.match(source, /await flushPushQueue\(/, `${caller.label} must await flushPushQueue`);

    // Structural proof of ordering: the call to performBookingCheckIn must
    // appear, textually, before the flushPushQueue call — since every one of
    // these callers is a single linear async function body (no loops/
    // branches re-entering the transaction after this point), and
    // performBookingCheckIn is always invoked as the `db.transaction(...)`
    // callback's return value, this ordering is exactly "transaction closes
    // (commit or throw), then — only on the success path — flush runs".
    const checkInCallIndex = source.indexOf("performBookingCheckIn(tx, {");
    const flushCallIndex = source.indexOf("await flushPushQueue(");
    assert.ok(checkInCallIndex !== -1, `${caller.label} must call performBookingCheckIn`);
    assert.ok(flushCallIndex !== -1, `${caller.label} must call flushPushQueue`);
    assert.ok(flushCallIndex > checkInCallIndex, `${caller.label}: flushPushQueue must appear after the performBookingCheckIn call`);
  });
}

test("no caller fires a detached (setTimeout/fire-and-forget) push outside notifications.ts's own fallback path", () => {
  for (const caller of CALLERS) {
    const source = read(caller.path);
    assert.doesNotMatch(source, /setTimeout\(/, `${caller.label} must never schedule a detached push itself`);
  }
});
