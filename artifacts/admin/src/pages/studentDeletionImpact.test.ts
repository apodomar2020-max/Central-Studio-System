/**
 * Source-inspection coverage for Phase B2C — Admin Deletion Impact Review UI
 * on the Student Detail page. Same style as studentAccountLifecycle.test.ts
 * (this app has no React component-rendering test harness, so coverage
 * confirms expected code patterns are present in the real source).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const detailSource = readFileSync(
  resolve(process.cwd(), "artifacts/admin/src/pages/student-detail.tsx"),
  "utf8",
);
const listSource = readFileSync(
  resolve(process.cwd(), "artifacts/admin/src/pages/students.tsx"),
  "utf8",
);

// ─── RBAC gating (1-4) ──────────────────────────────────────────────────────

test("1: Review Deletion Impact button is gated by can('users','delete')", () => {
  assert.match(
    detailSource,
    /can\("users", "delete"\) && d\.user\.accountStatus !== "deleted"/,
  );
  assert.match(detailSource, /aria-label="Review Deletion Impact"/);
});

test("2-3: gating uses users.delete only — not students.edit/parents.edit/students.view/users.edit", () => {
  const section = detailSource.match(
    /Permanent Account Deletion — review-only[\s\S]*?<\/Card>\s*\n\s*\)\}/,
  );
  assert.ok(section, "expected to find the Permanent Account Deletion card block");
  assert.doesNotMatch(section![0], /can\(lifecycleModule, "edit"\)/);
  assert.doesNotMatch(section![0], /can\("students", "view"\)/);
  assert.doesNotMatch(section![0], /can\("users", "edit"\)/);
});

test("4: Super Admin bypass is inherited from AdminAuthContext.can(), not re-implemented", () => {
  // can() is the same function used by the existing Deactivate/Reactivate
  // gate, which already relies on AdminAuthContext's isSuperAdmin bypass.
  const authSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/contexts/AdminAuthContext.tsx"),
    "utf8",
  );
  assert.match(authSource, /if \(user\.isSuperAdmin\) return true;/);
});

// ─── Lazy fetch (5-7) ───────────────────────────────────────────────────────

test("5: impact query is not enabled until the dialog is opened (lazy, not on page load)", () => {
  assert.match(
    detailSource,
    /enabled: impactDialogOpen && Number\.isInteger\(studentId\) && studentId > 0,/,
  );
});

test("6: clicking Review Deletion Impact opens the dialog and triggers a fetch", () => {
  assert.match(
    detailSource,
    /onClick=\{\(\) => \{ setImpactDialogOpen\(true\); void impactQuery\.refetch\(\); \}\}/,
  );
});

test("7: loading state is rendered while fetching", () => {
  assert.match(detailSource, /Loading deletion impact…/);
  assert.match(detailSource, /query\.isLoading \|\| \(query\.isFetching && !data && !hasError\)/);
});

// ─── Blockers / eligibility (8-11, 16) ─────────────────────────────────────

test("8: ACCOUNT_MUST_BE_DEACTIVATED blocker renders explanatory copy", () => {
  assert.match(
    detailSource,
    /b\.key === "ACCOUNT_MUST_BE_DEACTIVATED"/,
  );
  assert.match(
    detailSource,
    /The account must be deactivated before permanent deletion can eventually be performed\./,
  );
});

test("9: canDelete=false renders 'Not eligible for permanent deletion'", () => {
  assert.match(detailSource, /"Not eligible for permanent deletion\."/);
});

test("10: canDelete=true renders 'No current blockers detected.'", () => {
  assert.match(detailSource, /"No current blockers detected\."/);
});

test("11: no executable/final Delete button exists anywhere in the rendered output", () => {
  assert.doesNotMatch(detailSource, />Delete Account</);
  assert.doesNotMatch(detailSource, />Delete Permanently</);
  assert.doesNotMatch(detailSource, />Confirm Delete</);
  assert.doesNotMatch(detailSource, /aria-label="Delete Account"/);
  assert.doesNotMatch(detailSource, /aria-label="Delete Permanently"/);
  assert.match(detailSource, /Permanent deletion execution is not enabled yet\./);
});

test("16: resolutionHint is not referenced — the live B2B contract does not carry this field (see final report §A)", () => {
  // NOTE: StudentDeletionImpactBlocker in the generated schema only carries
  // key/label/description/count — no resolutionHint. Verified against both
  // the generated type and the backend's blockers.push(...) call sites.
  assert.doesNotMatch(detailSource, /resolutionHint/);
});

// ─── Four classification groups (12-15) ────────────────────────────────────

test("12-15: categories are grouped into exactly the four required buckets, pure passthrough of classification", () => {
  assert.match(detailSource, /\{ key: "blocker", title: "Must Resolve First" \}/);
  assert.match(detailSource, /\{ key: "anonymize", title: "Will Be Anonymized" \}/);
  assert.match(detailSource, /\{ key: "retain", title: "Will Be Retained" \}/);
  assert.match(detailSource, /\{ key: "delete", title: "Will Be Deleted" \}/);
  assert.match(
    detailSource,
    /data\.categories\.filter\(\(c\) => c\.classification === group\.key\)/,
  );
});

// ─── Zero counts (17) ───────────────────────────────────────────────────────

test("17: summary rows render raw numeric values (including 0) without hiding or special-casing falsy counts", () => {
  assert.match(detailSource, /value: summary\.bookings\.historical/);
  assert.doesNotMatch(detailSource, /summary\.bookings\.historical \|\| /);
});

// ─── Summary sections (18-24) ───────────────────────────────────────────────

test("18: bookings summary (historical/future)", () => {
  assert.match(detailSource, /title="Bookings"/);
  assert.match(detailSource, /label: "Historical", value: summary\.bookings\.historical/);
  assert.match(detailSource, /label: "Future", value: summary\.bookings\.future/);
});

test("19: payments summary (completed/pending/openRefunds)", () => {
  assert.match(detailSource, /title="Payments"/);
  assert.match(detailSource, /label: "Completed", value: summary\.payments\.completed/);
  assert.match(detailSource, /label: "Pending", value: summary\.payments\.pending/);
  assert.match(detailSource, /label: "Open refunds", value: summary\.payments\.openRefunds/);
});

test("20: packages summary (active/expired/unusedCredits/pendingOrders)", () => {
  assert.match(detailSource, /title="Packages"/);
  assert.match(detailSource, /label: "Active", value: summary\.packages\.active/);
  assert.match(detailSource, /label: "Expired", value: summary\.packages\.expired/);
  assert.match(detailSource, /label: "Unused credits", value: summary\.packages\.unusedCredits/);
  assert.match(detailSource, /label: "Pending orders", value: summary\.packages\.pendingOrders/);
});

test("21: children summary (total/withFutureActivity)", () => {
  assert.match(detailSource, /title="Children"/);
  assert.match(detailSource, /label: "Total", value: summary\.children\.total/);
  assert.match(detailSource, /label: "With future activity", value: summary\.children\.withFutureActivity/);
});

test("22: ballet summary (open/terminal/enrollments/pending/refunds)", () => {
  assert.match(detailSource, /title="Ballet"/);
  assert.match(detailSource, /label: "Open applications", value: summary\.ballet\.applicationsOpen/);
  assert.match(detailSource, /label: "Terminal applications", value: summary\.ballet\.applicationsTerminal/);
  assert.match(detailSource, /label: "Active enrollments", value: summary\.ballet\.enrollmentsActive/);
  assert.match(detailSource, /label: "Pending payments", value: summary\.ballet\.paymentsPending/);
  assert.match(detailSource, /label: "Open refunds", value: summary\.ballet\.refundsOpen/);
});

test("23: security summary (devices/otpChallenges/providerLinks)", () => {
  assert.match(detailSource, /title="Security"/);
  assert.match(detailSource, /label: "Devices", value: summary\.security\.devices/);
  assert.match(detailSource, /label: "OTP challenges", value: summary\.security\.otpChallenges/);
  assert.match(detailSource, /label: "Provider links", value: summary\.security\.providerLinks/);
});

test("24: legacy attribution summary (emailOnlyRows/ambiguousRows)", () => {
  assert.match(detailSource, /title="Legacy attribution"/);
  assert.match(detailSource, /label: "Email-only rows", value: summary\.legacyAttribution\.emailOnlyRows/);
  assert.match(detailSource, /label: "Ambiguous rows", value: summary\.legacyAttribution\.ambiguousRows/);
});

// ─── Legacy attribution warnings (25-26) ───────────────────────────────────

test("25: legacy backfill warning renders when emailOnlyRows > 0", () => {
  assert.match(detailSource, /summary\.legacyAttribution\.emailOnlyRows > 0/);
  assert.match(
    detailSource,
    /Some historical records are still linked through legacy identity data and must be safely/,
  );
});

test("26: ambiguous attribution warning renders when ambiguousRows > 0", () => {
  assert.match(detailSource, /summary\.legacyAttribution\.ambiguousRows > 0/);
  assert.match(detailSource, /Some historical records cannot yet be attributed safely\./);
});

// ─── No PII (27, L) ─────────────────────────────────────────────────────────

test("27: DeletionImpactDialog never references child/medical/emergency/contact PII fields", () => {
  const dialogBlock = detailSource.match(
    /function DeletionImpactDialog\([\s\S]*?\n\}\n/,
  );
  assert.ok(dialogBlock, "expected to find DeletionImpactDialog function body");
  assert.doesNotMatch(dialogBlock![0], /medicalNotes|emergencyName|emergencyPhone|dateOfBirth|fullName|\.email\b|\.phone\b/);
});

// ─── Refresh (28-29) ────────────────────────────────────────────────────────

test("28: Refresh Impact button re-calls query.refetch()", () => {
  assert.match(detailSource, /aria-label="Refresh Impact"/);
  assert.match(detailSource, /onClick=\{\(\) => void query\.refetch\(\)\}/);
});

test("29: refresh never calls a mutation endpoint — only the read-only query's refetch", () => {
  const dialogBlock = detailSource.match(
    /function DeletionImpactDialog\([\s\S]*?\n\}\n/,
  );
  assert.ok(dialogBlock);
  assert.doesNotMatch(dialogBlock![0], /\.mutate\(/);
  assert.doesNotMatch(dialogBlock![0], /useMutation/);
});

// ─── Stale data on failure (30) ─────────────────────────────────────────────

test("30: on error, stale data is never rendered — error branch takes priority over any cached data", () => {
  assert.match(detailSource, /hasError \|\| !data \? \(/);
});

// ─── Error handling (31-34) ─────────────────────────────────────────────────

test("31: 403 handled with a clear permission-denied message, no crash, no retry button", () => {
  assert.match(detailSource, /status === 403/);
  assert.match(detailSource, /You don't have permission to review deletion impact/);
});

test("32: 404 handled with a clear 'student no longer exists' message", () => {
  assert.match(detailSource, /status === 404/);
  assert.match(detailSource, /This student no longer exists\./);
});

test("33: 409 handled with an 'already deleted / not eligible' message", () => {
  assert.match(detailSource, /status === 409/);
  assert.match(detailSource, /already permanently deleted/);
});

test("34: generic 500/network failure shown with a 'Try again' retry option", () => {
  assert.match(detailSource, /Could not load the deletion impact review\. Please try again\./);
  assert.match(detailSource, />\s*Try again\s*</);
});

// ─── generatedAt / policyVersion / staleness (35-37) ───────────────────────

test("35: generatedAt is displayed", () => {
  assert.match(detailSource, /Generated: \{formatDateTime\(data\.generatedAt\)\}/);
});

test("36: policyVersion is displayed", () => {
  assert.match(detailSource, /Policy version: \{data\.policyVersion\}/);
});

test("37: staleness/revalidation copy is displayed, without implying a locked promise", () => {
  assert.match(
    detailSource,
    /This analysis reflects the current account state and will be revalidated before any future\s*\n\s*permanent deletion\./,
  );
});

// ─── Open from either lifecycle state (38-39) ──────────────────────────────

test("38-39: the Permanent Account Deletion card (and its Review button) renders whenever accountStatus !== 'deleted' — covers both active and deactivated", () => {
  assert.match(
    detailSource,
    /can\("users", "delete"\) && d\.user\.accountStatus !== "deleted"/,
  );
  // Confirms it is not additionally gated to only one specific lifecycle
  // state (e.g. not `=== "active"` or `=== "deactivated"` only).
  const section = detailSource.match(
    /Permanent Account Deletion — review-only[\s\S]*?<\/Card>\s*\n\s*\)\}/,
  );
  assert.ok(section);
  assert.doesNotMatch(section![0], /accountStatus === "active"/);
  assert.doesNotMatch(section![0], /accountStatus === "deactivated"/);
});

// ─── Existing Deactivate/Reactivate unchanged (40-41) ──────────────────────

test("40: existing Deactivate flow (useDeactivateStudent, confirmDeactivate) is untouched", () => {
  assert.match(detailSource, /const deactivateMutation = useDeactivateStudent\(/);
  assert.match(
    detailSource,
    /deactivateMutation\.mutate\(\{ id: studentId, data: reason \? \{ reason \} : undefined \}\);/,
  );
});

test("41: existing Reactivate flow (useReactivateStudent, confirmReactivate) is untouched", () => {
  assert.match(detailSource, /const reactivateMutation = useReactivateStudent\(/);
  assert.match(detailSource, /reactivateMutation\.mutate\(\{ id: studentId \}\);/);
});

// ─── Permanent-delete / mutation absence (42-44) ───────────────────────────

test("42: no legacy deleteStudent call/import anywhere in student-detail.tsx or students.tsx", () => {
  assert.doesNotMatch(detailSource, /useDeleteStudent|deleteStudent\(/);
  assert.doesNotMatch(listSource, /useDeleteStudent|deleteStudent\(/);
});

test("43: no permanent-delete mutation (DELETE /students/:id or any permanent-delete route) exists in student-detail.tsx", () => {
  assert.doesNotMatch(detailSource, /method:\s*["']DELETE["']/);
  assert.doesNotMatch(detailSource, /permanent-delete|permanentDelete/i);
});

// Phase B3B3 narrowed this guard. The ONE backfill mutation now permitted is
// the proven-ownership executor (useApplyStudentDeletionOwnershipBackfill),
// which populates a canonical historical ownership FK and nothing else.
// Anonymization remains categorically forbidden, and no OTHER backfill
// mutation may appear.
test("44: no anonymization mutation, and the only backfill call is the proven-ownership executor", () => {
  assert.doesNotMatch(detailSource, /anonymize\w*\(/i);
  assert.doesNotMatch(detailSource, /useAnonymize/i);

  const backfillHooks = detailSource.match(/use\w*Backfill\w*/gi) ?? [];
  for (const hook of backfillHooks) {
    assert.equal(hook, "useApplyStudentDeletionOwnershipBackfill", `unexpected backfill hook: ${hook}`);
  }
  assert.ok(backfillHooks.length > 0, "the proven-ownership backfill hook must be the one used");
});

// ─── Student 34 absence (45) ────────────────────────────────────────────────

test("45: student id 34 is not hardcoded or referenced anywhere in this feature's new code", () => {
  const newCodeBlock = detailSource.slice(detailSource.indexOf("IMPACT_GROUPS"));
  assert.doesNotMatch(newCodeBlock, /\b34\b/);
});

// ─── Component / hook usage sanity ─────────────────────────────────────────

test("uses the real generated hook useGetStudentDeletionImpact, not a hand-rolled fetch", () => {
  assert.match(detailSource, /const impactQuery = useGetStudentDeletionImpact<StudentDeletionImpactResponse>\(studentId, \{/);
  assert.match(detailSource, /staleTime: 0,/);
  assert.match(detailSource, /gcTime: 0,/);
});

test("impact response is never persisted to localStorage/sessionStorage", () => {
  const dialogBlock = detailSource.match(
    /function DeletionImpactDialog\([\s\S]*?\n\}\n/,
  );
  assert.ok(dialogBlock);
  assert.doesNotMatch(dialogBlock![0], /localStorage|sessionStorage/);
});
