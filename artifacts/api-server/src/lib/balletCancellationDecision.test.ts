/**
 * Behavioral tests for the shared status → destructive-action rule.
 *
 * Lives under artifacts/api-server/src/lib/ (not lib/api-zod/src/ or
 * lib/db/src/) to match this repo's convention: those two packages are
 * declaration-only composite `tsc -b` builds with no "node" types configured,
 * so `node:test`/`node:assert` files must not live inside their `src/`.
 * Every other ballet node:test file already follows this rule.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveBalletDangerAction,
  isBalletOpenCancellationStatus,
  BALLET_CANCELLATION_INITIATOR_TYPES,
  BALLET_PRE_ACTIVATION_CANCELLABLE_STATUSES,
} from "@workspace/api-zod";

// ─── Status → action matrix (synthetic inputs) ──────────────────────────────────

test("pending shows Cancel Application", () => {
  assert.deepEqual(
    resolveBalletDangerAction({ applicationStatus: "pending", viewer: "parent" }),
    { kind: "cancelApplication" },
  );
});

test("needsFollowUp shows Cancel Application", () => {
  assert.equal(
    resolveBalletDangerAction({ applicationStatus: "needsFollowUp", viewer: "parent" }).kind,
    "cancelApplication",
  );
});

test("accepted shows Cancel Application", () => {
  assert.equal(
    resolveBalletDangerAction({ applicationStatus: "accepted", viewer: "admin" }).kind,
    "cancelApplication",
  );
});

test("assignedToLevel shows Cancel Application (pre-activation), even with an assignment", () => {
  assert.equal(
    resolveBalletDangerAction({ applicationStatus: "assignedToLevel", assignmentStatus: "active", viewer: "parent" }).kind,
    "cancelApplication",
  );
});

test("active enrollment with active assignment shows Cancel Program", () => {
  assert.equal(
    resolveBalletDangerAction({ applicationStatus: "active", assignmentStatus: "active", viewer: "parent" }).kind,
    "cancelProgram",
  );
});

test("active without an active assignment shows no destructive action", () => {
  assert.equal(
    resolveBalletDangerAction({ applicationStatus: "active", assignmentStatus: null, viewer: "parent" }).kind,
    "none",
  );
});

test("open pendingReview request hides duplicate Cancel Program (parent can withdraw)", () => {
  const action = resolveBalletDangerAction({
    applicationStatus: "active",
    assignmentStatus: "active",
    openCancellationRequestStatus: "pendingReview",
    viewer: "parent",
  });
  assert.equal(action.kind, "viewCancellationRequest");
  assert.equal(action.kind === "viewCancellationRequest" && action.canWithdraw, true);
});

test("open approved request hides Cancel Program and cannot be withdrawn", () => {
  const action = resolveBalletDangerAction({
    applicationStatus: "active",
    assignmentStatus: "active",
    openCancellationRequestStatus: "approved",
    viewer: "parent",
  });
  assert.equal(action.kind, "viewCancellationRequest");
  assert.equal(action.kind === "viewCancellationRequest" && action.canWithdraw, false);
});

test("admin never sees a Withdraw affordance (Manage only)", () => {
  const action = resolveBalletDangerAction({
    applicationStatus: "active",
    assignmentStatus: "active",
    openCancellationRequestStatus: "pendingReview",
    viewer: "admin",
  });
  assert.equal(action.kind, "viewCancellationRequest");
  assert.equal(action.kind === "viewCancellationRequest" && action.canWithdraw, false);
});

test("withdrawn hides cancellation and allows Apply Again when reapplication is allowed", () => {
  assert.equal(
    resolveBalletDangerAction({ applicationStatus: "withdrawn", viewer: "parent", reapplyAllowed: true }).kind,
    "applyAgain",
  );
});

test("cancelled/rejected terminal states hide the destructive button", () => {
  for (const status of ["cancelled", "rejected", "withdrawn"]) {
    assert.equal(
      resolveBalletDangerAction({ applicationStatus: status, viewer: "parent", reapplyAllowed: false }).kind,
      "none",
    );
  }
});

test("admin terminal (reapplyAllowed=false) shows no Apply Again", () => {
  assert.equal(
    resolveBalletDangerAction({ applicationStatus: "withdrawn", viewer: "admin", reapplyAllowed: false }).kind,
    "none",
  );
});

// ─── Helpers / constants ────────────────────────────────────────────────────────

test("open-cancellation predicate only matches pendingReview and approved", () => {
  assert.equal(isBalletOpenCancellationStatus("pendingReview"), true);
  assert.equal(isBalletOpenCancellationStatus("approved"), true);
  assert.equal(isBalletOpenCancellationStatus("completed"), false);
  assert.equal(isBalletOpenCancellationStatus("rejected"), false);
  assert.equal(isBalletOpenCancellationStatus(null), false);
});

test("initiator types are exactly parent and admin", () => {
  assert.deepEqual([...BALLET_CANCELLATION_INITIATOR_TYPES], ["parent", "admin"]);
});

test("pre-activation cancellable statuses match the spec set", () => {
  assert.deepEqual(
    [...BALLET_PRE_ACTIVATION_CANCELLABLE_STATUSES],
    ["pending", "needsFollowUp", "accepted", "assignedToLevel"],
  );
});

// ─── §6: mobile main Ballet screen, using real API-response-shaped objects ──────
//
// These mirror the exact JSON shapes returned by GET /api/ballet/applications/my
// and GET /api/ballet/applications/:id (BalletApplicationDetail in
// balletAssessmentService.ts), not hand-picked enum values, so a shape drift in
// the real API response would show up here.

interface FakeApplication { status: string }
interface FakeAssignment { id: number; status: string }
interface FakeCancellationRequest { id: number; status: string }
interface FakeApplicationDetail {
  application: FakeApplication;
  activeAssignment: FakeAssignment | null;
  openCancellationRequest: FakeCancellationRequest | null;
}

function mobileAction(detail: FakeApplicationDetail, accountType: "parent" | "student" = "parent") {
  if (accountType !== "parent") return { kind: "none" as const };
  return resolveBalletDangerAction({
    applicationStatus: detail.application.status,
    assignmentStatus: detail.activeAssignment?.status ?? null,
    openCancellationRequestStatus: detail.openCancellationRequest?.status ?? null,
    viewer: "parent",
    reapplyAllowed: true,
  });
}

test("mobile: pending application detail shape → Cancel Application", () => {
  const detail: FakeApplicationDetail = {
    application: { status: "pending" },
    activeAssignment: null,
    openCancellationRequest: null,
  };
  assert.equal(mobileAction(detail).kind, "cancelApplication");
});

test("mobile: active application + active assignment shape → Cancel Program", () => {
  const detail: FakeApplicationDetail = {
    application: { status: "active" },
    activeAssignment: { id: 42, status: "active" },
    openCancellationRequest: null,
  };
  assert.equal(mobileAction(detail).kind, "cancelProgram");
});

test("mobile: open cancellation request shape → View Request", () => {
  const detail: FakeApplicationDetail = {
    application: { status: "active" },
    activeAssignment: { id: 42, status: "active" },
    openCancellationRequest: { id: 7, status: "pendingReview" },
  };
  assert.equal(mobileAction(detail).kind, "viewCancellationRequest");
});

test("mobile: pendingReview open request → Withdraw available", () => {
  const detail: FakeApplicationDetail = {
    application: { status: "active" },
    activeAssignment: { id: 42, status: "active" },
    openCancellationRequest: { id: 7, status: "pendingReview" },
  };
  const action = mobileAction(detail);
  assert.equal(action.kind === "viewCancellationRequest" && action.canWithdraw, true);
});

test("mobile: approved open request → Withdraw hidden", () => {
  const detail: FakeApplicationDetail = {
    application: { status: "active" },
    activeAssignment: { id: 42, status: "active" },
    openCancellationRequest: { id: 7, status: "approved" },
  };
  const action = mobileAction(detail);
  assert.equal(action.kind === "viewCancellationRequest" && action.canWithdraw, false);
});

test("mobile: withdrawn application shape → Apply Again", () => {
  const detail: FakeApplicationDetail = {
    application: { status: "withdrawn" },
    activeAssignment: null,
    openCancellationRequest: null,
  };
  assert.equal(mobileAction(detail).kind, "applyAgain");
});

test("mobile: non-parent account (student) → no destructive action regardless of status", () => {
  const detail: FakeApplicationDetail = {
    application: { status: "active" },
    activeAssignment: { id: 42, status: "active" },
    openCancellationRequest: null,
  };
  assert.equal(mobileAction(detail, "student").kind, "none");
});

// ─── §6: admin Application Detail, using real API-response-shaped objects ──────

interface FakeAdminDetail {
  application: FakeApplication;
  assignmentId: number | null;
  cancellationRequests: FakeCancellationRequest[];
}

function adminAction(detail: FakeAdminDetail, canCancel: boolean) {
  if (!canCancel) return { kind: "none" as const };
  const openRequest = detail.cancellationRequests.find((r) => r.status === "pendingReview" || r.status === "approved") ?? null;
  return resolveBalletDangerAction({
    applicationStatus: detail.application.status,
    assignmentStatus: detail.assignmentId != null ? "active" : null,
    openCancellationRequestStatus: openRequest?.status ?? null,
    viewer: "admin",
    reapplyAllowed: false,
  });
}

test("admin: pre-active application detail shape → Cancel Application", () => {
  const detail: FakeAdminDetail = { application: { status: "accepted" }, assignmentId: null, cancellationRequests: [] };
  assert.equal(adminAction(detail, true).kind, "cancelApplication");
});

test("admin: active application detail shape → Cancel Program", () => {
  const detail: FakeAdminDetail = { application: { status: "active" }, assignmentId: 9, cancellationRequests: [] };
  assert.equal(adminAction(detail, true).kind, "cancelProgram");
});

test("admin: open cancellation request in the requests array → Manage Cancellation Request", () => {
  const detail: FakeAdminDetail = {
    application: { status: "active" },
    assignmentId: 9,
    cancellationRequests: [{ id: 3, status: "pendingReview" }],
  };
  assert.equal(adminAction(detail, true).kind, "viewCancellationRequest");
});

test("admin: terminal status shape → no destructive button (reapplyAllowed=false for admin)", () => {
  const detail: FakeAdminDetail = { application: { status: "withdrawn" }, assignmentId: null, cancellationRequests: [] };
  assert.equal(adminAction(detail, true).kind, "none");
});

test("admin: missing ballet.applications:cancel permission → no Danger Zone action regardless of status", () => {
  const detail: FakeAdminDetail = { application: { status: "active" }, assignmentId: 9, cancellationRequests: [] };
  assert.equal(adminAction(detail, false).kind, "none");
});
