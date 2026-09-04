/**
 * balletAssessmentStateModel — pure, framework-free state-transition logic
 * extracted from app/ballet/assessment.tsx so the eligibility/Review/submit
 * invariants (Regression 1 fix) can be unit-tested without a React Native
 * component-rendering setup. The repository has no react-test-renderer /
 * @testing-library/react-native / jest configured (confirmed by inspecting
 * package.json before writing this), so this mirrors the existing
 * balletStudentPreviewModel.ts pattern: pure functions, tested with plain
 * node:test, imported directly by the screen so behavior can never drift
 * from what's actually tested.
 */

export type AssessmentStep = "child" | "appointment" | "package" | "review";

export const ASSESSMENT_STEP_ORDER: AssessmentStep[] = ["child", "appointment", "package", "review"];

// ─── Part A — visible/eligible children must wait for applications ────────
//
// The routed Add Another Child flow must never treat a routed child as
// provisionally selectable while the authoritative applications list is
// still resolving — that is what let a since-blocked child progress all
// the way to Review. Returns an empty list (not "everyone") until ready.
// The non-routed flow (effectiveEligibleChildIds == null) returns every
// child unfiltered, exactly as before — untouched, so the normal
// application flow is never blocked by this change.

export interface AssessmentChildLike {
  id: string;
}

export interface AssessmentApplicationLike {
  status: string;
}

export function computeVisibleAssessmentChildren<T extends AssessmentChildLike, A extends AssessmentApplicationLike>(input: {
  children: readonly T[];
  applications: A[];
  applicationsReady: boolean;
  effectiveEligibleChildIds: ReadonlySet<number> | null;
  sessionCreatedChildIds: ReadonlySet<number>;
  blockingStatuses: ReadonlySet<string>;
  getChildApplicationStatus: (child: T, applications: A[]) => string | null;
}): T[] {
  const {
    children,
    applications,
    applicationsReady,
    effectiveEligibleChildIds,
    sessionCreatedChildIds,
    blockingStatuses,
    getChildApplicationStatus,
  } = input;

  if (effectiveEligibleChildIds == null) return [...children];

  return children.filter((child) => {
    const childId = Number(child.id);
    if (!Number.isInteger(childId) || !effectiveEligibleChildIds.has(childId)) return false;
    if (sessionCreatedChildIds.has(childId)) return true;
    // Part A fix: previously `return true` here — a routed child was
    // provisionally treated as visible while applications were still
    // loading. Now nothing is visible until the authoritative data
    // resolves; the screen shows its existing loading state instead
    // (driven separately by applicationsState, unchanged).
    if (!applicationsReady) return false;
    const status = getChildApplicationStatus(child, applications);
    return status == null || !blockingStatuses.has(status);
  });
}

// ─── Part B — eligibility reconciliation while the user is mid-flow ───────
//
// Replaces the previous effect's single behavior (silently
// `setSelectedChild(null)` regardless of which step the user was on, which
// left Review/Package rendering with a hole in its required state). The
// decision is now step-aware and always paired with an explicit,
// recoverable action — never a silent clear that leaves the current step
// unchanged.

export type ChildEligibilityAction =
  | { type: "none" }
  | { type: "preselect"; childId: string }
  | { type: "clearOnChildStep" }
  | { type: "bounceToChild" };

export function decideChildEligibilityAction(input: {
  hasRoutedAllowList: boolean;
  applicationsReady: boolean;
  /** Part C — a completed submission's identity is frozen; eligibility
   *  reconciliation must never touch it again. */
  hasSubmittedSnapshot: boolean;
  /** Editing one's own just-submitted application: its own "pending"
   *  status is what would otherwise make the child look ineligible —
   *  reconciliation must not fight the user out of editing it. */
  hasEditingApplication: boolean;
  /** A submission request is already in flight: the identity being
   *  submitted was already locked into an immutable draft snapshot before
   *  the request began, so an applications refetch resolving mid-flight
   *  must not bounce the screen or clear the selection out from under it.
   *  This only suppresses the reconciliation UI reaction — it grants no
   *  submission permission; canSubmitAssessment is the sole gate on
   *  whether a request is allowed to start in the first place, and any
   *  conflict discovered before the request begins still recovers
   *  normally via the branches below. */
  isSubmissionInFlight: boolean;
  selectedChildId: string | null;
  isSessionCreatedSelectedChild: boolean;
  step: AssessmentStep;
  visibleChildIds: readonly string[];
}): ChildEligibilityAction {
  const {
    hasRoutedAllowList,
    applicationsReady,
    hasSubmittedSnapshot,
    hasEditingApplication,
    isSubmissionInFlight,
    selectedChildId,
    isSessionCreatedSelectedChild,
    step,
    visibleChildIds,
  } = input;

  if (!hasRoutedAllowList || !applicationsReady) return { type: "none" };
  if (hasSubmittedSnapshot || hasEditingApplication || isSubmissionInFlight) return { type: "none" };
  if (selectedChildId != null && isSessionCreatedSelectedChild) return { type: "none" };

  if (step === "child") {
    if (visibleChildIds.length === 1) {
      const onlyId = visibleChildIds[0]!;
      if (selectedChildId !== onlyId) return { type: "preselect", childId: onlyId };
      return { type: "none" };
    }
    if (selectedChildId != null && !visibleChildIds.includes(selectedChildId)) {
      return { type: "clearOnChildStep" };
    }
    return { type: "none" };
  }

  // appointment / package / review — never silently clear in place. If the
  // selected child is no longer eligible, the only allowed action is an
  // explicit bounce back to the Child step (clearing the dependent
  // Date selection along with it), never a bare clear that leaves
  // the current step rendering with missing data.
  if (selectedChildId != null && !visibleChildIds.includes(selectedChildId)) {
    return { type: "bounceToChild" };
  }
  return { type: "none" };
}

// ─── Part D — Review must never render with silently-missing data ─────────

export function computeReviewMissingStep(input: {
  step: AssessmentStep;
  hasChild: boolean;
  hasAppointment: boolean;
}): AssessmentStep | null {
  if (input.step !== "review") return null;
  if (!input.hasChild) return "child";
  if (!input.hasAppointment) return "appointment";
  return null;
}

// ─── Part E — submit guard ─────────────────────────────────────────────────

export function canSubmitAssessment(input: {
  hasUser: boolean;
  hasChild: boolean;
  hasAppointment: boolean;
  isSubmitting: boolean;
  hasSubmittedSnapshot: boolean;
}): boolean {
  return (
    input.hasUser
    && input.hasChild
    && input.hasAppointment
    && !input.isSubmitting
    && !input.hasSubmittedSnapshot
  );
}

// ─── Part C — immutable submission snapshot ────────────────────────────────
//
// A plain reference capture (not a deep clone) is sufficient: nothing in
// this screen ever mutates selectedChild/selectedAppointment
// in place — they are always replaced wholesale via their setters — so
// capturing the references at submit time is enough to make the snapshot
// immune to those state variables later being set to null or reassigned.
//
// Split into two steps to make the required ordering structurally obvious
// at the call site, not just true by accident of closure capture:
//   1. buildAssessmentSubmissionDraft — called AFTER validation but BEFORE
//      the POST is awaited, from the already-validated local variables.
//   2. finalizeAssessmentSubmissionSnapshot — called on success, and does
//      nothing but ADD the server-returned applicationId/status onto the
//      existing draft. It never re-reads child/appointment from
//      anywhere — it can't, because they aren't inputs to this function —
//      so it is structurally impossible for it to rebuild the identity
//      portion from (possibly since-changed) live state after the await.

export interface AssessmentSubmissionDraft<TChild, TAppointment> {
  child: TChild;
  appointment: TAppointment;
  paymentLabel: string;
}

export function buildAssessmentSubmissionDraft<TChild, TAppointment>(input: {
  child: TChild;
  appointment: TAppointment;
  paymentLabel: string;
}): AssessmentSubmissionDraft<TChild, TAppointment> {
  return { ...input };
}

export interface AssessmentSubmissionSnapshot<TChild, TAppointment>
  extends AssessmentSubmissionDraft<TChild, TAppointment> {
  applicationId: number;
  status: string | null;
}

export function finalizeAssessmentSubmissionSnapshot<TChild, TAppointment>(
  draft: AssessmentSubmissionDraft<TChild, TAppointment>,
  result: { applicationId: number; status: string | null },
): AssessmentSubmissionSnapshot<TChild, TAppointment> {
  return { ...draft, ...result };
}

// ─── Canonical child-ID normalization ──────────────────────────────────────
//
// ChildProfile.id is a string on the mobile client (matching this app's
// general entity-id convention), but the backend's children table uses a
// numeric serial primary key, and childId-accepting endpoints (assessment
// schedules, application submission) validate it with
// z.coerce.number().int().positive(). This is the single place that
// normalization happens: it rejects anything that isn't a positive integer
// rather than coercing garbage into a number, so a malformed id can never
// silently reach a request as NaN or a stringified non-number.

export function parseCanonicalChildId(id: string): number | null {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}
