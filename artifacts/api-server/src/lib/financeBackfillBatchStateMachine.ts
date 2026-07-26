/**
 * Finance Phase 2D-2 — batch lifecycle state machine.
 *
 * Pure, side-effect-free transition rules for `payment_backfill_batches`.
 * Every transition is validated against this matrix BEFORE any DB write is
 * attempted (see financeBackfillBatchService.ts), so a forbidden transition
 * never reaches the database as a raw constraint violation.
 *
 * "running" here is control-state only — Phase 2D-2 has no mutating writer,
 * so entering "running" does not process a single source row. See
 * financeBackfillBatchService.ts's startBatch for the explicit note this
 * decision required.
 */

export const BATCH_STATUSES = [
  "created",
  "dry_run_completed",
  "approved",
  "running",
  "paused",
  "cancelled",
  "completed",
  "failed",
  "rolled_back",
] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_TERMINAL_STATUSES: readonly BatchStatus[] = [
  "cancelled",
  "completed",
  "failed",
  "rolled_back",
];

export function isTerminalBatchStatus(status: BatchStatus): boolean {
  return (BATCH_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export type BatchAction =
  | "attach_dry_run_evidence"
  | "approve"
  | "start"
  | "pause"
  | "resume"
  | "cancel"
  | "complete"
  | "fail";

export class BatchTransitionError extends Error {
  constructor(
    public readonly code:
      | "forbidden_transition"
      | "terminal_state"
      | "stale_approval"
      | "already_in_target_state",
    message: string,
  ) {
    super(message);
  }
}

/** action -> allowed (from-status -> to-status) pairs. */
const TRANSITIONS: Record<BatchAction, Partial<Record<BatchStatus, BatchStatus>>> = {
  attach_dry_run_evidence: { created: "dry_run_completed" },
  approve: { dry_run_completed: "approved" },
  start: { approved: "running" },
  pause: { running: "paused" },
  resume: { paused: "running" },
  cancel: {
    created: "cancelled",
    dry_run_completed: "cancelled",
    approved: "cancelled",
    paused: "cancelled",
  },
  complete: { running: "completed" },
  // Policy decision (Phase 2D-2): both "running" and "paused" may transition
  // directly to "failed" — nothing in the schema restricts a failure signal
  // to only the running state, and a batch paused mid-way can still be
  // marked failed (e.g. an operator abandoning it) without first resuming
  // it. This is the only action with more than one valid source status.
  fail: { running: "failed", paused: "failed" },
};

/**
 * Idempotent-safe re-application: calling the same action again when the
 * batch is ALREADY in that action's target state is a no-op success, not an
 * error — e.g. pausing an already-paused batch, cancelling an
 * already-cancelled batch. Distinguished from a genuinely forbidden
 * transition (e.g. pausing a completed batch).
 */
const IDEMPOTENT_TARGET_OF: Record<BatchAction, BatchStatus> = {
  attach_dry_run_evidence: "dry_run_completed",
  approve: "approved",
  start: "running",
  pause: "paused",
  resume: "running",
  cancel: "cancelled",
  complete: "completed",
  fail: "failed",
};

export interface TransitionResult {
  toStatus: BatchStatus;
  /** true when the batch was already in the target state and no write is needed. */
  noop: boolean;
}

/**
 * Validates (does not perform) a transition. Throws BatchTransitionError on
 * any forbidden transition, including attempts to leave a terminal state.
 */
export function planTransition(currentStatus: BatchStatus, action: BatchAction): TransitionResult {
  const idempotentTarget = IDEMPOTENT_TARGET_OF[action];
  if (currentStatus === idempotentTarget) {
    return { toStatus: currentStatus, noop: true };
  }

  if (isTerminalBatchStatus(currentStatus)) {
    throw new BatchTransitionError(
      "terminal_state",
      `batch is in terminal status "${currentStatus}" and cannot transition via "${action}"`,
    );
  }

  const allowed = TRANSITIONS[action];
  const toStatus = allowed[currentStatus];
  if (!toStatus) {
    throw new BatchTransitionError(
      "forbidden_transition",
      `"${action}" is not a valid transition from status "${currentStatus}"`,
    );
  }

  return { toStatus, noop: false };
}
