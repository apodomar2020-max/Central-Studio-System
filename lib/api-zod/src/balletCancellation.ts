/**
 * Shared Ballet enrollment-cancellation enums and the single source of truth
 * for the status → destructive-action decision.
 *
 * The Cancellation Requests + Refunds backend already exists (migration 0068,
 * routes/balletCancellationRefunds.ts, lib/balletCancellationFinalization.ts).
 * This module does NOT introduce a second cancellation architecture — it only
 * hoists the small set of literals + the gating rule that the mobile app, the
 * admin app, and the API all need to agree on so that no screen ever renders an
 * unconditional Cancel button from stale local state.
 */

import {
  BALLET_TERMINAL_APPLICATION_STATUSES,
  type BalletApplicationStatus,
  type BalletLevelAssignmentStatus,
} from "./ballet";

/** Lifecycle of a ballet_enrollment_cancellation_requests row. */
export const BALLET_ENROLLMENT_CANCELLATION_STATUSES = [
  "pendingReview",
  "approved",
  "rejected",
  "withdrawnByParent",
  "completed",
] as const;

export type BalletEnrollmentCancellationStatus =
  (typeof BALLET_ENROLLMENT_CANCELLATION_STATUSES)[number];

/**
 * Statuses that count as an *open* request — i.e. a request that is still
 * active in the workflow and must suppress a second "Cancel Program" button.
 */
export const BALLET_OPEN_CANCELLATION_STATUSES = ["pendingReview", "approved"] as const;

export type BalletOpenCancellationStatus = (typeof BALLET_OPEN_CANCELLATION_STATUSES)[number];

/** When the parent/admin wants the cancellation to take effect. */
export const BALLET_ENROLLMENT_CANCELLATION_TIMINGS = ["immediate", "endOfPeriod"] as const;

export type BalletEnrollmentCancellationTiming =
  (typeof BALLET_ENROLLMENT_CANCELLATION_TIMINGS)[number];

/**
 * Who initiated the cancellation request. Recorded on every request row so the
 * admin list/detail can attribute it to the parent or to the acting admin.
 */
export const BALLET_CANCELLATION_INITIATOR_TYPES = ["parent", "admin"] as const;

export type BalletCancellationInitiatorType =
  (typeof BALLET_CANCELLATION_INITIATOR_TYPES)[number];

export const BALLET_CANCELLATION_INITIATOR_LABELS: Record<BalletCancellationInitiatorType, string> = {
  parent: "Parent",
  admin: "Admin",
};

/**
 * Pre-activation application statuses where the parent/admin cancels the
 * *application* (not an active enrollment) via the pre-activation endpoint.
 */
export const BALLET_PRE_ACTIVATION_CANCELLABLE_STATUSES = [
  "pending",
  "needsFollowUp",
  "accepted",
  "assignedToLevel",
] as const;

export type BalletPreActivationCancellableStatus =
  (typeof BALLET_PRE_ACTIVATION_CANCELLABLE_STATUSES)[number];

export function isBalletOpenCancellationStatus(status: string | null | undefined): status is BalletOpenCancellationStatus {
  return status != null && (BALLET_OPEN_CANCELLATION_STATUSES as readonly string[]).includes(status);
}

// ─── Status → destructive-action decision ──────────────────────────────────────

export type BalletDangerAction =
  | { kind: "cancelApplication" }
  | { kind: "cancelProgram" }
  | { kind: "viewCancellationRequest"; requestStatus: BalletOpenCancellationStatus; canWithdraw: boolean }
  | { kind: "applyAgain" }
  | { kind: "none" };

export interface BalletDangerActionInput {
  /** Authoritative current application status from the server. */
  applicationStatus: BalletApplicationStatus | string;
  /** Status of the current level assignment, or null when there is none. */
  assignmentStatus?: BalletLevelAssignmentStatus | string | null;
  /** Status of the most recent open cancellation request, or null. */
  openCancellationRequestStatus?: BalletEnrollmentCancellationStatus | string | null;
  /** Parent (mobile) sees Withdraw; admin sees Manage. */
  viewer: "parent" | "admin";
  /**
   * Whether existing reapplication rules currently allow submitting a new
   * application for a terminal-status record. Defaults to true.
   */
  reapplyAllowed?: boolean;
}

/**
 * The single gating rule shared by mobile, admin, and the success/status
 * screens. Given authoritative server state, returns which — if any —
 * destructive cancellation action to surface.
 *
 * Order matters: an open cancellation request always wins over a fresh
 * "Cancel Program" button, and pre-activation cancellation wins over the
 * active-enrollment path.
 */
export function resolveBalletDangerAction(input: BalletDangerActionInput): BalletDangerAction {
  const {
    applicationStatus,
    assignmentStatus,
    openCancellationRequestStatus,
    viewer,
    reapplyAllowed = true,
  } = input;

  // 1. An open cancellation request suppresses any Cancel button and is shown
  //    as View / Manage (+ Withdraw for the parent while still pendingReview).
  if (isBalletOpenCancellationStatus(openCancellationRequestStatus)) {
    return {
      kind: "viewCancellationRequest",
      requestStatus: openCancellationRequestStatus,
      canWithdraw: viewer === "parent" && openCancellationRequestStatus === "pendingReview",
    };
  }

  // 2. Pre-activation application cancellation.
  if ((BALLET_PRE_ACTIVATION_CANCELLABLE_STATUSES as readonly string[]).includes(applicationStatus)) {
    return { kind: "cancelApplication" };
  }

  // 3. Active enrollment cancellation-request flow.
  if (applicationStatus === "active" && assignmentStatus === "active") {
    return { kind: "cancelProgram" };
  }

  // 4. Terminal states — offer Apply Again only when reapplication is allowed.
  if ((BALLET_TERMINAL_APPLICATION_STATUSES as readonly string[]).includes(applicationStatus)) {
    return reapplyAllowed ? { kind: "applyAgain" } : { kind: "none" };
  }

  return { kind: "none" };
}
