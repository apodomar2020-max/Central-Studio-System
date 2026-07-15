import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const routes = readFileSync(
  resolve(process.cwd(), "artifacts/api-server/src/routes/balletCancellationRefunds.ts"),
  "utf8",
);
const finalizer = readFileSync(
  resolve(process.cwd(), "artifacts/api-server/src/lib/balletCancellationFinalization.ts"),
  "utf8",
);

test("Admin pre-activation cancellation audit records structured before and after state", () => {
  assert.match(routes, /action: "cancel"/);
  assert.match(routes, /beforeApplicationStatus: result\.beforeApplicationStatus/);
  assert.match(routes, /afterApplicationStatus: "cancelled"/);
  assert.match(routes, /beforeAssignmentStatus: result\.assignment\?\.status/);
  assert.match(routes, /afterAssignmentStatus: result\.assignment \? "withdrawn" : null/);
  assert.match(routes, /parentReason: parsed\.data\.reason/);
});

test("Cancellation finalization audit is emitted from the shared idempotent finalizer", () => {
  assert.match(finalizer, /if \(didMutate\) \{/);
  assert.match(finalizer, /logActivityWithActor\(client, input\.auditActor \?\? systemActivityActor\(\)/);
  assert.match(finalizer, /action: input\.auditAction \?\? \(input\.forceImmediate \? "approveImmediate" : "finalize"\)/);
  assert.match(finalizer, /beforeApplicationStatus: app\.status/);
  assert.match(finalizer, /afterApplicationStatus: "withdrawn"/);
  assert.match(finalizer, /beforeAssignmentStatus: assignment\.status/);
  assert.match(finalizer, /afterAssignmentStatus: "withdrawn"/);
  assert.match(finalizer, /beforeCancellationRequestStatus: request\.status/);
  assert.match(finalizer, /afterCancellationRequestStatus: "completed"/);
});

test("Admin scheduled approval and rejection audit records request timing/status transitions", () => {
  assert.match(routes, /action: "approveEndOfPeriod"/);
  assert.match(routes, /beforeCancellationRequestStatus: result\.beforeRequest\.status/);
  assert.match(routes, /afterCancellationRequestStatus: result\.request\.status/);
  assert.match(routes, /requestedTiming: result\.request\.requestedTiming/);
  assert.match(routes, /approvedTiming: result\.request\.approvedTiming/);
  assert.match(routes, /approvedEffectiveDate: result\.request\.approvedEffectiveDate/);
  assert.match(routes, /action: "reject"/);
});

test("Refund transition audit records structured before and after status, amount, method, payment, and reference fields", () => {
  for (const action of ['action: "approve"', 'action: "reject"', 'action: "processing"', 'action: "complete"', 'action: "fail"']) {
    assert.match(routes, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(routes, /beforeRefundStatus: result\.beforeRefund\.status/);
  assert.match(routes, /afterRefundStatus: result\.refund\.status/);
  assert.match(routes, /approvedRefundAmount: result\.refund\.approvedAmountEgp/);
  assert.match(routes, /completedRefundAmount: result\.refund\.refundedAmountEgp/);
  assert.match(routes, /refundMethod: result\.refund\.refundMethod/);
  assert.match(routes, /transactionReference: result\.refund\.transactionReference/);
  assert.match(routes, /paymentId: result\.payment\.id/);
});

test("Idempotent refund transitions only write audit rows when mutation occurred", () => {
  assert.match(routes, /if \(result\.didMutate\) await logActivity\(req, \{\s+action: "reject"/);
  assert.match(routes, /if \(result\.didMutate\) await logActivity\(req, \{\s+action: "processing"/);
  assert.match(routes, /if \(result\.didMutate\) await logActivity\(req, \{\s+action: "complete"/);
  assert.match(routes, /if \(result\.didMutate\) await logActivity\(req, \{\s+action: "fail"/);
});
