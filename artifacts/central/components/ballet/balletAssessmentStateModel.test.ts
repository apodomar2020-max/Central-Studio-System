import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAssessmentSubmissionDraft,
  canSubmitAssessment,
  computeReviewMissingStep,
  computeVisibleAssessmentChildren,
  decideChildEligibilityAction,
  finalizeAssessmentSubmissionSnapshot,
  parseCanonicalChildId,
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
} from "./balletAssessmentStateModel.ts";

const BLOCKING_STATUSES = new Set(["pending", "accepted", "needsFollowUp", "assignedToLevel", "active"]);

function child(id: string) {
  return { id };
}

function applicationsFor(byChildId: Record<string, string>) {
  return (targetChild: { id: string }, applications: { status: string }[]) => {
    void applications;
    return byChildId[targetChild.id] ?? null;
  };
}

// ── computeVisibleAssessmentChildren (Part A) ───────────────────────────────

test("a routed eligible child waits for applications instead of appearing provisionally", () => {
  const visible = computeVisibleAssessmentChildren({
    children: [child("9")],
    applications: [],
    applicationsReady: false,
    effectiveEligibleChildIds: new Set([9]),
    sessionCreatedChildIds: new Set(),
    blockingStatuses: BLOCKING_STATUSES,
    getChildApplicationStatus: applicationsFor({}),
  });
  assert.deepEqual(visible, []);
});

test("a blocked child is never provisionally progressed while applications are loading", () => {
  // Even a child that WILL turn out blocked once data resolves must not be
  // visible while loading — the old bug returned `true` unconditionally here.
  const visible = computeVisibleAssessmentChildren({
    children: [child("9")],
    applications: [],
    applicationsReady: false,
    effectiveEligibleChildIds: new Set([9]),
    sessionCreatedChildIds: new Set(),
    blockingStatuses: BLOCKING_STATUSES,
    getChildApplicationStatus: applicationsFor({ "9": "pending" }),
  });
  assert.deepEqual(visible, []);
});

test("a child remains selectable once authoritative data confirms no blocking application", () => {
  const visible = computeVisibleAssessmentChildren({
    children: [child("9")],
    applications: [],
    applicationsReady: true,
    effectiveEligibleChildIds: new Set([9]),
    sessionCreatedChildIds: new Set(),
    blockingStatuses: BLOCKING_STATUSES,
    getChildApplicationStatus: applicationsFor({}),
  });
  assert.deepEqual(visible.map((entry) => entry.id), ["9"]);
});

test("a child with a blocking application is excluded once data is ready", () => {
  const visible = computeVisibleAssessmentChildren({
    children: [child("9")],
    applications: [],
    applicationsReady: true,
    effectiveEligibleChildIds: new Set([9]),
    sessionCreatedChildIds: new Set(),
    blockingStatuses: BLOCKING_STATUSES,
    getChildApplicationStatus: applicationsFor({ "9": "pending" }),
  });
  assert.deepEqual(visible, []);
});

test("a session-created child is always visible regardless of loading state", () => {
  const visible = computeVisibleAssessmentChildren({
    children: [child("9")],
    applications: [],
    applicationsReady: false,
    effectiveEligibleChildIds: new Set([9]),
    sessionCreatedChildIds: new Set([9]),
    blockingStatuses: BLOCKING_STATUSES,
    getChildApplicationStatus: applicationsFor({}),
  });
  assert.deepEqual(visible.map((entry) => entry.id), ["9"]);
});

test("the non-routed flow is unaffected by the loading gate", () => {
  const visible = computeVisibleAssessmentChildren({
    children: [child("1"), child("2")],
    applications: [],
    applicationsReady: false,
    effectiveEligibleChildIds: null,
    sessionCreatedChildIds: new Set(),
    blockingStatuses: BLOCKING_STATUSES,
    getChildApplicationStatus: applicationsFor({}),
  });
  assert.deepEqual(visible.map((entry) => entry.id), ["1", "2"]);
});

// ── decideChildEligibilityAction (Part B) ───────────────────────────────────

const baseAction = {
  hasRoutedAllowList: true,
  applicationsReady: true,
  hasSubmittedSnapshot: false,
  hasEditingApplication: false,
  isSubmissionInFlight: false,
  isSessionCreatedSelectedChild: false,
};

test("a selected child becoming blocked on the Child step clears safely without touching other steps", () => {
  const action = decideChildEligibilityAction({
    ...baseAction,
    selectedChildId: "9",
    step: "child",
    visibleChildIds: [],
  });
  assert.deepEqual(action, { type: "clearOnChildStep" });
});

test("a selected child becoming blocked on Review bounces to Child instead of leaving Review blank", () => {
  const action = decideChildEligibilityAction({
    ...baseAction,
    selectedChildId: "9",
    step: "review",
    visibleChildIds: [],
  });
  assert.deepEqual(action, { type: "bounceToChild" });
});

test("a pre-submit eligibility conflict on Appointment or Package also bounces explicitly to Child", () => {
  for (const step of ["appointment", "package"] as const) {
    const action = decideChildEligibilityAction({
      ...baseAction,
      selectedChildId: "9",
      step,
      visibleChildIds: [],
    });
    assert.deepEqual(action, { type: "bounceToChild" });
  }
});

test("a completed submission snapshot freezes eligibility reconciliation", () => {
  const action = decideChildEligibilityAction({
    ...baseAction,
    hasSubmittedSnapshot: true,
    selectedChildId: "9",
    step: "review",
    visibleChildIds: [],
  });
  assert.deepEqual(action, { type: "none" });
});

test("editing one's own just-submitted application is not fought by eligibility reconciliation", () => {
  const action = decideChildEligibilityAction({
    ...baseAction,
    hasEditingApplication: true,
    selectedChildId: "9",
    step: "review",
    visibleChildIds: [],
  });
  assert.deepEqual(action, { type: "none" });
});

test("a submission in flight is not erased by an applications refetch resolving mid-request", () => {
  // The identity being submitted is already locked into an immutable draft
  // snapshot before the request began — an eligibility reconciliation pass
  // that resolves while the POST is still in flight must not bounce the
  // screen or clear the selection out from under it.
  const action = decideChildEligibilityAction({
    ...baseAction,
    isSubmissionInFlight: true,
    selectedChildId: "9",
    step: "review",
    visibleChildIds: [],
  });
  assert.deepEqual(action, { type: "none" });
});

test("a genuine pre-submit conflict discovered before the request begins still recovers to Child", () => {
  // Same conflict as above, but isSubmissionInFlight is false — this is the
  // "before the request begins" case the in-flight exemption must not mask.
  const action = decideChildEligibilityAction({
    ...baseAction,
    isSubmissionInFlight: false,
    selectedChildId: "9",
    step: "review",
    visibleChildIds: [],
  });
  assert.deepEqual(action, { type: "bounceToChild" });
});

test("a single visible routed child is preselected", () => {
  const action = decideChildEligibilityAction({
    ...baseAction,
    selectedChildId: null,
    step: "child",
    visibleChildIds: ["9"],
  });
  assert.deepEqual(action, { type: "preselect", childId: "9" });
});

test("a still-eligible selected child is left untouched", () => {
  const action = decideChildEligibilityAction({
    ...baseAction,
    selectedChildId: "9",
    step: "review",
    visibleChildIds: ["9", "10"],
  });
  assert.deepEqual(action, { type: "none" });
});

test("the non-routed flow never triggers eligibility reconciliation", () => {
  const action = decideChildEligibilityAction({
    ...baseAction,
    hasRoutedAllowList: false,
    selectedChildId: "9",
    step: "review",
    visibleChildIds: [],
  });
  assert.deepEqual(action, { type: "none" });
});

// ── computeReviewMissingStep (Part D) ───────────────────────────────────────

test("Review without a selected child recovers to Child, never a blank body", () => {
  assert.equal(computeReviewMissingStep({ step: "review", hasChild: false, hasAppointment: true, hasPackage: true }), "child");
});

test("Review without a selected appointment recovers to Appointment", () => {
  assert.equal(computeReviewMissingStep({ step: "review", hasChild: true, hasAppointment: false, hasPackage: true }), "appointment");
});

test("Review without a selected package recovers to Package", () => {
  assert.equal(computeReviewMissingStep({ step: "review", hasChild: true, hasAppointment: true, hasPackage: false }), "package");
});

test("Review with everything present needs no recovery", () => {
  assert.equal(computeReviewMissingStep({ step: "review", hasChild: true, hasAppointment: true, hasPackage: true }), null);
});

test("non-Review steps never trigger the recovery check", () => {
  assert.equal(computeReviewMissingStep({ step: "child", hasChild: false, hasAppointment: false, hasPackage: false }), null);
});

// ── canSubmitAssessment (Part E) ─────────────────────────────────────────────

const baseSubmit = { hasUser: true, hasChild: true, hasAppointment: true, hasPackage: true, isSubmitting: false, hasSubmittedSnapshot: false };

test("submission is allowed once every required selection is present", () => {
  assert.equal(canSubmitAssessment(baseSubmit), true);
});

test("a second tap while a submission is already in flight is rejected", () => {
  assert.equal(canSubmitAssessment({ ...baseSubmit, isSubmitting: true }), false);
});

test("a tap after a submission has already produced a snapshot is rejected", () => {
  assert.equal(canSubmitAssessment({ ...baseSubmit, hasSubmittedSnapshot: true }), false);
});

test("submission is rejected when any required selection is missing", () => {
  assert.equal(canSubmitAssessment({ ...baseSubmit, hasChild: false }), false);
  assert.equal(canSubmitAssessment({ ...baseSubmit, hasAppointment: false }), false);
  assert.equal(canSubmitAssessment({ ...baseSubmit, hasPackage: false }), false);
  assert.equal(canSubmitAssessment({ ...baseSubmit, hasUser: false }), false);
});

// ── buildAssessmentSubmissionDraft / finalizeAssessmentSubmissionSnapshot (Part C) ──

test("the submission draft is captured before the async request and captures exactly the validated identity", () => {
  const childRef = { id: "9", fullName: "Nour Ali" };
  const appointmentRef = { scheduleId: 4, date: "2026-08-01", time: "10:00" };
  const packageRef = { id: 2, name: "Standard" };
  const draft = buildAssessmentSubmissionDraft({
    child: childRef,
    appointment: appointmentRef,
    pkg: packageRef,
    paymentLabel: "Pay at Studio",
  });
  assert.deepEqual(draft, {
    child: childRef,
    appointment: appointmentRef,
    pkg: packageRef,
    paymentLabel: "Pay at Studio",
  });
});

test("finalizing only adds the server-returned identity onto the existing draft", () => {
  const draft = buildAssessmentSubmissionDraft({
    child: { id: "9" },
    appointment: { scheduleId: 4, date: "2026-08-01" },
    pkg: { id: 2 },
    paymentLabel: "Pay at Studio",
  });
  const snapshot = finalizeAssessmentSubmissionSnapshot(draft, { applicationId: 71, status: "pending" });
  assert.deepEqual(snapshot, {
    child: { id: "9" },
    appointment: { scheduleId: 4, date: "2026-08-01" },
    pkg: { id: 2 },
    paymentLabel: "Pay at Studio",
    applicationId: 71,
    status: "pending",
  });
});

test("mutable selection changing while the request is pending does not alter the finalized snapshot", () => {
  // Simulates: draft built from selectedChild before the await; selectedChild
  // is then reassigned (e.g. by an eligibility reconciliation pass or the
  // user's own next action) while the request is still in flight; the
  // finalized snapshot must still reflect the ORIGINAL validated identity,
  // because finalizeAssessmentSubmissionSnapshot never re-reads live state —
  // it only has the draft and the server response as inputs.
  let selectedChild: { id: string; fullName: string } | null = { id: "9", fullName: "Nour Ali" };
  const draft = buildAssessmentSubmissionDraft({
    child: selectedChild,
    appointment: { scheduleId: 1, date: "2026-08-01" },
    pkg: { id: 1 },
    paymentLabel: "Pay at Studio",
  });

  // The awaited POST is "in flight" here — mutable state changes underneath.
  selectedChild = { id: "12", fullName: "A Different Child" };

  const snapshot = finalizeAssessmentSubmissionSnapshot(draft, { applicationId: 1, status: "pending" });
  assert.equal(snapshot.child.id, "9");
  assert.equal(snapshot.child.fullName, "Nour Ali");
});

test("the finalized snapshot is immune to the live selection state being cleared afterwards", () => {
  let selectedChild: { id: string } | null = { id: "9" };
  const draft = buildAssessmentSubmissionDraft({
    child: selectedChild,
    appointment: { scheduleId: 1, date: "2026-08-01" },
    pkg: { id: 1 },
    paymentLabel: "Pay at Studio",
  });
  selectedChild = null; // simulates a later eligibility reconciliation pass
  const snapshot = finalizeAssessmentSubmissionSnapshot(draft, { applicationId: 1, status: "pending" });
  assert.equal(snapshot.child.id, "9");
});

// ── parseCanonicalChildId ────────────────────────────────────────────────────

test("a canonical numeric child id string is passed through as a number", () => {
  assert.equal(parseCanonicalChildId("9"), 9);
  assert.equal(parseCanonicalChildId("142"), 142);
});

test("an invalid child id is never silently coerced — it is rejected outright", () => {
  assert.equal(parseCanonicalChildId(""), null);
  assert.equal(parseCanonicalChildId("abc"), null);
  assert.equal(parseCanonicalChildId("9abc"), null);
  assert.equal(parseCanonicalChildId("9.5"), null);
  assert.equal(parseCanonicalChildId("-9"), null);
  assert.equal(parseCanonicalChildId("0"), null);
  assert.equal(parseCanonicalChildId("NaN"), null);
  assert.equal(parseCanonicalChildId(" "), null);
});
