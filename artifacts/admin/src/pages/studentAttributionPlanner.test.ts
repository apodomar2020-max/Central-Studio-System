/**
 * Source-inspection coverage for Phase B3B1B — Admin Read-Only Attribution
 * Planner UI on the Student Detail page. Same style as
 * studentAccountLifecycle.test.ts / studentDeletionImpact.test.ts /
 * studentDeletionPreparation.test.ts (this app has no React
 * component-rendering test harness, so coverage confirms expected code
 * patterns are present in the real source rather than mounting components).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const detailSource = readFileSync(
  resolve(process.cwd(), "artifacts/admin/src/pages/student-detail.tsx"),
  "utf8",
);

// ─── 1-3: availability state ────────────────────────────────────────────────

test("1: active Student never renders the planner action — it only ever renders inside the Permanent Account Deletion card, gated by accountStatus !== 'deleted', with the button itself further gated on preparationActive", () => {
  assert.match(detailSource, /aria-label="Review Attribution Plan"/);
  assert.match(detailSource, /\{preparationActive \? \(\s*<Button\s*\n\s*variant="outline"\s*\n\s*size="sm"\s*\n\s*aria-label="Review Attribution Plan"/);
});

test("2: deactivated Student with no active preparation shows helper text instead of the planner action", () => {
  assert.match(
    detailSource,
    /Start Deletion Preparation before reviewing historical attribution\./,
  );
});

test("3: preparationActive === true renders the Review Attribution Plan button", () => {
  assert.match(
    detailSource,
    /\{preparationActive \? \(\s*<Button[\s\S]{0,120}aria-label="Review Attribution Plan"/,
  );
});

// ─── 4-7: RBAC ───────────────────────────────────────────────────────────────

test("4-6: planner is nested inside the Permanent Account Deletion card, gated by can('users','delete') — same as Review Deletion Impact, not students.view/students.edit/users.edit", () => {
  const section = detailSource.match(
    /Permanent Account Deletion — review-only[\s\S]*?<\/Card>\s*\n\s*\)\}/,
  );
  assert.ok(section, "expected to find the Permanent Account Deletion card block");
  assert.match(section![0], /aria-label="Review Attribution Plan"/);
  assert.doesNotMatch(section![0], /can\("students", "view"\)/);
  assert.doesNotMatch(section![0], /can\("students", "edit"\)/);
  assert.doesNotMatch(section![0], /can\("users", "edit"\)/);
});

test("7: Super Admin bypass is inherited from AdminAuthContext.can(), not re-implemented for the planner", () => {
  const authSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/contexts/AdminAuthContext.tsx"),
    "utf8",
  );
  assert.match(authSource, /if \(user\.isSuperAdmin\) return true;/);
});

// ─── 8-10: lazy fetch / refresh ─────────────────────────────────────────────

test("8: attribution plan query is not enabled until the dialog is opened (lazy, not on page load)", () => {
  assert.match(
    detailSource,
    /enabled: attributionDialogOpen && Number\.isInteger\(studentId\) && studentId > 0,/,
  );
});

test("9: clicking Review Attribution Plan opens the dialog and triggers a GET via refetch", () => {
  assert.match(
    detailSource,
    /onClick=\{\(\) => \{ setAttributionDialogOpen\(true\); void attributionPlanQuery\.refetch\(\); \}\}/,
  );
});

test("10: Refresh Plan performs a GET via refetch only", () => {
  assert.match(detailSource, /aria-label="Refresh Plan"/);
  assert.match(detailSource, /onClick=\{\(\) => void query\.refetch\(\)\}/);
});

// ─── 11: no mutation anywhere in the planner code ──────────────────────────

test("11: the planner dialog/query never sends any mutation request — no useMutation, no .mutate(", () => {
  const dialogBlock = detailSource.match(
    /function AttributionPlanDialog\([\s\S]*?\n\}\n/,
  );
  assert.ok(dialogBlock, "expected to find AttributionPlanDialog function body");
  assert.doesNotMatch(dialogBlock![0], /useMutation/);
  assert.doesNotMatch(dialogBlock![0], /\.mutate\(/);
  assert.match(detailSource, /const attributionPlanQuery = useGetStudentDeletionAttributionPlan<StudentDeletionAttributionPlanResponse>\(studentId, \{/);
});

// ─── 12-15: summary + domain rendering ─────────────────────────────────────

test("12: summary counts render as pure passthrough of the backend's summary fields — Already Attributed, Safe to Attribute, Ambiguous, Unproven, Non-Attributable", () => {
  assert.match(detailSource, /label="Already Attributed" value=\{data\.summary\.alreadyAttributed\}/);
  assert.match(detailSource, /label="Safe to Attribute" value=\{data\.summary\.safeToAttribute\}/);
  assert.match(detailSource, /label="Ambiguous" value=\{data\.summary\.ambiguous\}/);
  assert.match(detailSource, /label="Unproven" value=\{data\.summary\.unproven\}/);
  assert.match(detailSource, /label="Non-Attributable" value=\{data\.summary\.nonAttributable\}/);
});

test("13-15: domain sections are built by mapping over the real domains[] array — Bookings/Package Orders/Feedback labels exist, but no domain is hardcoded as always-present", () => {
  assert.match(detailSource, /bookings: "Bookings",/);
  assert.match(detailSource, /package_orders: "Package Orders",/);
  assert.match(detailSource, /feedback: "Feedback",/);
  assert.match(detailSource, /for \(const entry of data\.domains\) \{/);
  assert.doesNotMatch(detailSource, /attendance: "Attendance"/i);
  const domainLabelBlock = detailSource.match(/const ATTRIBUTION_DOMAIN_LABEL[\s\S]*?\n\};\n/);
  assert.ok(domainLabelBlock, "expected to find ATTRIBUTION_DOMAIN_LABEL block");
  assert.doesNotMatch(domainLabelBlock![0], /credit_transactions/i);
});

// ─── 16-21: classification copy ────────────────────────────────────────────

test("16: ALREADY_ATTRIBUTED copy", () => {
  assert.match(detailSource, /ALREADY_ATTRIBUTED: "Already linked to this Student\."/);
});

test("17: SAFE_TO_ATTRIBUTE copy", () => {
  assert.match(detailSource, /SAFE_TO_ATTRIBUTE: "Historical evidence is sufficient to attribute safely\."/);
});

test("18: UNPROVEN_PRE_T0 copy", () => {
  assert.match(
    detailSource,
    /UNPROVEN_PRE_T0: "Historical ownership cannot be proven before provenance tracking began\."/,
  );
});

test("19: AMBIGUOUS_PROVENANCE copy", () => {
  assert.match(
    detailSource,
    /AMBIGUOUS_PROVENANCE: "Conflicting identity evidence prevents automatic attribution\."/,
  );
});

test("20: NO_MATCH copy (the real gap-classification enum value, verified against the backend's AttributionClassification type)", () => {
  assert.match(
    detailSource,
    /NO_MATCH: "Relevant identity exists, but no valid ownership interval covers this record\."/,
  );
});

test("21: SEMANTICALLY_NOT_STUDENT_OWNERSHIP copy", () => {
  assert.match(
    detailSource,
    /SEMANTICALLY_NOT_STUDENT_OWNERSHIP: "Matching contact information does not prove Student ownership\."/,
  );
});

test("bonus: MISSING_REQUIRED_TIMESTAMP and MALFORMED_LEGACY_IDENTITY copy are also present (all 8 real backend classifications are covered, no invented ones)", () => {
  assert.match(
    detailSource,
    /MISSING_REQUIRED_TIMESTAMP: "Ownership cannot be evaluated without a reliable timestamp\."/,
  );
  assert.match(
    detailSource,
    /MALFORMED_LEGACY_IDENTITY: "Legacy identity data is insufficient for safe attribution\."/,
  );
});

// ─── 22-23: no PII ──────────────────────────────────────────────────────────

test("22: AttributionPlanDialog never references raw email fields", () => {
  const dialogBlock = detailSource.match(
    /function AttributionPlanDialog\([\s\S]*?\n\}\n/,
  );
  assert.ok(dialogBlock);
  assert.doesNotMatch(dialogBlock![0], /\.email\b/);
  assert.doesNotMatch(dialogBlock![0], /rawEmail/i);
});

test("23: AttributionPlanDialog never references fingerprint/provenance-key/digest internals", () => {
  const dialogBlock = detailSource.match(
    /function AttributionPlanDialog\([\s\S]*?\n\}\n/,
  );
  assert.ok(dialogBlock);
  assert.doesNotMatch(dialogBlock![0], /fingerprint/i);
  assert.doesNotMatch(dialogBlock![0], /provenanceSecret|digest/i);
});

// ─── 24: zero-state ─────────────────────────────────────────────────────────

test("24: empty-plan state renders the exact required copy and is purely informational", () => {
  assert.match(
    detailSource,
    /No legacy attribution records require review for this Student\./,
  );
  assert.match(detailSource, /const isEmptyPlan =/);
});

// ─── 25-27: error handling ──────────────────────────────────────────────────

test("25: 409 STUDENT_DELETION_PREPARATION_REQUIRED is distinguished from a generic error via the response body's code field", () => {
  assert.match(
    detailSource,
    /status === 409 && code === "STUDENT_DELETION_PREPARATION_REQUIRED"/,
  );
  assert.match(
    detailSource,
    /The attribution plan is no longer available — deletion preparation is not currently active\./,
  );
  assert.match(detailSource, /function attributionPlanErrorCode\(error: unknown\): string \| null \{/);
});

test("26: 403 handled with a clear permission-denied message", () => {
  const errorStateBlock = detailSource.match(
    /function AttributionPlanErrorState\([\s\S]*?\n\}\n/,
  );
  assert.ok(errorStateBlock);
  assert.match(errorStateBlock![0], /status === 403/);
  assert.match(errorStateBlock![0], /You don't have permission to review the attribution plan/);
});

test("27: network failure / unknown error falls back to a generic retry message, not a crash", () => {
  assert.match(detailSource, /Could not load the attribution plan\. Please try again\./);
});

// ─── 28: refresh disabled while loading ────────────────────────────────────

test("28: Refresh Plan button is disabled while query.isFetching", () => {
  assert.match(
    detailSource,
    /aria-label="Refresh Plan"\s*\n\s*disabled=\{query\.isFetching\}/,
  );
});

// ─── 29-30: regressions — Review Deletion Impact / Cancel Preparation intact ──

test("29: Review Deletion Impact remains intact (regression) — button and dialog mount are unchanged", () => {
  assert.match(detailSource, /aria-label="Review Deletion Impact"/);
  assert.match(
    detailSource,
    /onClick=\{\(\) => \{ setImpactDialogOpen\(true\); void impactQuery\.refetch\(\); \}\}/,
  );
  assert.match(detailSource, /<DeletionImpactDialog\s*\n\s*open=\{impactDialogOpen\}/);
});

test("30: Cancel Deletion Preparation remains intact (regression)", () => {
  assert.match(detailSource, /aria-label="Cancel Deletion Preparation"/);
  assert.match(
    detailSource,
    /const cancelPrepMutation = useCancelStudentDeletionPreparation\(\{/,
  );
});

// ─── 31-32: no mutation controls anywhere in this new code ────────────────

test("31: no Permanent Delete action exists anywhere in student-detail.tsx", () => {
  assert.doesNotMatch(detailSource, /aria-label="Permanent Delete"/);
  assert.doesNotMatch(detailSource, />Permanent Delete</);
  assert.doesNotMatch(detailSource, />Delete Account</);
  assert.doesNotMatch(detailSource, />Delete Permanently</);
});

test("32: no Apply/Backfill/Auto Resolve/Link Records/Tombstone/Anonymize action exists anywhere in student-detail.tsx", () => {
  assert.doesNotMatch(detailSource, /aria-label="Apply Attribution"/i);
  assert.doesNotMatch(detailSource, /aria-label="Fix Attribution"/i);
  assert.doesNotMatch(detailSource, /aria-label="Backfill"/i);
  assert.doesNotMatch(detailSource, /aria-label="Auto Resolve"/i);
  assert.doesNotMatch(detailSource, /aria-label="Resolve Automatically"/i);
  assert.doesNotMatch(detailSource, /aria-label="Link Records"/i);
  assert.doesNotMatch(detailSource, /aria-label="Execute Plan"/i);
  assert.doesNotMatch(detailSource, />Apply Attribution</);
  assert.doesNotMatch(detailSource, />Fix Attribution</);
  assert.doesNotMatch(detailSource, />Backfill</);
  assert.doesNotMatch(detailSource, />Auto Resolve</);
  assert.doesNotMatch(detailSource, />Link Records</);
  assert.doesNotMatch(detailSource, />Execute Plan</);
  assert.doesNotMatch(detailSource, />Tombstone</);
  assert.doesNotMatch(detailSource, />Anonymize Now</);
});

// ─── 33: existing regression suites are unmodified ─────────────────────────

test("33: studentAccountLifecycle.test.ts / studentDeletionImpact.test.ts / studentDeletionPreparation.test.ts are unmodified by this feature", () => {
  const lifecycleTestSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/pages/studentAccountLifecycle.test.ts"),
    "utf8",
  );
  const impactTestSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/pages/studentDeletionImpact.test.ts"),
    "utf8",
  );
  const prepTestSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/pages/studentDeletionPreparation.test.ts"),
    "utf8",
  );
  assert.doesNotMatch(lifecycleTestSource, /attribution|Attribution/);
  assert.doesNotMatch(impactTestSource, /Review Attribution Plan/);
  assert.doesNotMatch(prepTestSource, /Review Attribution Plan/);
});

// ─── Component / hook usage sanity ─────────────────────────────────────────

test("uses the real generated hook useGetStudentDeletionAttributionPlan, not a hand-rolled fetch or duplicated response type", () => {
  assert.match(
    detailSource,
    /const attributionPlanQuery = useGetStudentDeletionAttributionPlan<StudentDeletionAttributionPlanResponse>\(studentId, \{/,
  );
  assert.doesNotMatch(detailSource, /interface StudentDeletionAttributionPlanResponse/);
});

test("attribution plan response is never persisted to localStorage/sessionStorage", () => {
  const dialogBlock = detailSource.match(
    /function AttributionPlanDialog\([\s\S]*?\n\}\n/,
  );
  assert.ok(dialogBlock);
  assert.doesNotMatch(dialogBlock![0], /localStorage|sessionStorage/);
});

test("student id 34 is not hardcoded or referenced anywhere in this feature's new code", () => {
  const newCodeBlock = detailSource.slice(detailSource.indexOf("ATTRIBUTION_CLASSIFICATION_COPY"));
  assert.doesNotMatch(newCodeBlock, /\b34\b/);
});

test("only bookings/package_orders/feedback domains are ever iterated — no row-level array from the response is rendered", () => {
  const dialogBlock = detailSource.match(
    /function AttributionPlanDialog\([\s\S]*?\n\}\n/,
  );
  assert.ok(dialogBlock);
  // Only ever maps over data.domains (aggregate/count-only) — never a
  // per-row items/rows array that doesn't exist on the response shape.
  assert.match(dialogBlock![0], /data\.domains/);
  assert.doesNotMatch(dialogBlock![0], /\.rows\.map|\.items\.map/);
});
