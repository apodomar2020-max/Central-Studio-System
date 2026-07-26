import assert from "node:assert/strict";
import test from "node:test";

import {
  planTransition,
  isTerminalBatchStatus,
  BatchTransitionError,
  BATCH_TERMINAL_STATUSES,
  type BatchStatus,
  type BatchAction,
} from "./financeBackfillBatchStateMachine";

const ALLOWED: Array<[BatchStatus, BatchAction, BatchStatus]> = [
  ["created", "attach_dry_run_evidence", "dry_run_completed"],
  ["dry_run_completed", "approve", "approved"],
  ["approved", "start", "running"],
  ["running", "pause", "paused"],
  ["paused", "resume", "running"],
  ["created", "cancel", "cancelled"],
  ["dry_run_completed", "cancel", "cancelled"],
  ["approved", "cancel", "cancelled"],
  ["paused", "cancel", "cancelled"],
  ["running", "complete", "completed"],
  ["running", "fail", "failed"],
  ["paused", "fail", "failed"],
];

for (const [from, action, to] of ALLOWED) {
  test(`allowed: ${from} --${action}--> ${to}`, () => {
    const result = planTransition(from, action);
    assert.equal(result.toStatus, to);
    assert.equal(result.noop, false);
  });
}

const FORBIDDEN: Array<[BatchStatus, BatchAction]> = [
  ["created", "approve"],
  ["created", "start"],
  ["created", "pause"],
  ["created", "resume"],
  ["created", "complete"],
  ["created", "fail"],
  ["dry_run_completed", "start"],
  ["dry_run_completed", "pause"],
  ["dry_run_completed", "complete"],
  ["approved", "pause"],
  ["approved", "complete"],
  ["approved", "fail"],
  ["running", "approve"],
  ["paused", "start"],
  ["paused", "approve"],
  ["paused", "complete"],
];

for (const [from, action] of FORBIDDEN) {
  test(`forbidden: ${from} --${action}--> (rejected)`, () => {
    assert.throws(() => planTransition(from, action), BatchTransitionError);
  });
}

for (const terminal of BATCH_TERMINAL_STATUSES) {
  test(`terminal-state protection: "${terminal}" cannot transition via any non-idempotent action`, () => {
    assert.equal(isTerminalBatchStatus(terminal), true);
    // "cancel"/"complete"/"fail" applied to a terminal state that IS their
    // own idempotent target (e.g. cancel on an already-cancelled batch) is
    // a no-op success, not a rejection — excluded here and covered instead
    // by the dedicated idempotency test below.
    const idempotentSelfTargets: BatchStatus[] = ["cancelled", "completed", "failed"];
    const allActions: BatchAction[] = ["approve", "start", "pause", "resume", "cancel", "complete", "fail"];
    const actions = idempotentSelfTargets.includes(terminal)
      ? allActions.filter((a) => !(a === "cancel" && terminal === "cancelled") && !(a === "complete" && terminal === "completed") && !(a === "fail" && terminal === "failed"))
      : allActions;
    for (const action of actions) {
      assert.throws(
        () => planTransition(terminal, action),
        (err: unknown) => {
          assert.ok(err instanceof BatchTransitionError);
          assert.equal(err.code, "terminal_state");
          return true;
        },
      );
    }
  });
}

test("idempotent: repeated identical transition is a no-op, not an error", () => {
  assert.deepEqual(planTransition("paused", "pause"), { toStatus: "paused", noop: true });
  assert.deepEqual(planTransition("cancelled", "cancel"), { toStatus: "cancelled", noop: true });
  assert.deepEqual(planTransition("running", "start"), { toStatus: "running", noop: true });
  assert.deepEqual(planTransition("approved", "approve"), { toStatus: "approved", noop: true });
  assert.deepEqual(planTransition("completed", "complete"), { toStatus: "completed", noop: true });
  assert.deepEqual(planTransition("failed", "fail"), { toStatus: "failed", noop: true });
});

test("cancelled batch cannot resume", () => {
  assert.throws(() => planTransition("cancelled", "resume"), (err: unknown) => {
    assert.ok(err instanceof BatchTransitionError);
    assert.equal(err.code, "terminal_state");
    return true;
  });
});

test("completed batch cannot mutate via any action", () => {
  for (const action of ["approve", "start", "pause", "resume", "cancel"] as BatchAction[]) {
    assert.throws(() => planTransition("completed", action), BatchTransitionError);
  }
});

test("failed batch has no restart transition (requires an explicit new batch)", () => {
  for (const action of ["approve", "start", "pause", "resume", "complete"] as BatchAction[]) {
    assert.throws(() => planTransition("failed", action), BatchTransitionError);
  }
});
