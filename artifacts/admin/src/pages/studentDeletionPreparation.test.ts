/**
 * Source-inspection coverage for Phase B3B0-2B — Admin UI for Deletion
 * Preparation (Start/Cancel) on the Student Detail page. Same style as
 * studentAccountLifecycle.test.ts / studentDeletionImpact.test.ts (this app
 * has no React component-rendering test harness, so coverage confirms
 * expected code patterns are present in the real source rather than
 * mounting components).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const detailSource = readFileSync(
  resolve(process.cwd(), "artifacts/admin/src/pages/student-detail.tsx"),
  "utf8",
);

// ─── 1-2: Active Student shows Deactivate only, no Start/Cancel ────────────

test("1: active Student's Account Access card shows Deactivate, not the reactivate/Start branch", () => {
  assert.match(detailSource, /d\.user\.accountStatus === "active" \? \(/);
  assert.match(detailSource, /Deactivate Account/);
});

test("2: Start Deletion Preparation is only ever rendered inside the accountStatus === 'deactivated' branch of the Deletion Preparation card, never unconditionally", () => {
  assert.match(
    detailSource,
    /: d\.user\.accountStatus === "deactivated" \? \(\s*<>\s*<p className="text-sm text-muted-foreground">Deletion preparation has not started\.<\/p>\s*<Button[\s\S]*?aria-label="Start Deletion Preparation"/,
  );
});

// ─── 3-4: deactivated states ────────────────────────────────────────────────

test("3: deactivated + no active preparation shows both Reactivate and Start Deletion Preparation", () => {
  assert.match(detailSource, /aria-label="Reactivate account"/);
  assert.match(detailSource, /aria-label="Start Deletion Preparation"/);
});

test("4: preparing state shows Cancel Deletion Preparation", () => {
  assert.match(detailSource, /aria-label="Cancel Deletion Preparation"/);
  assert.match(detailSource, /preparationActive \? \(\s*<>\s*<p className="text-sm text-white">\s*Deletion Preparation Active/);
});

// ─── 5: preparing state blocks/hides Reactivate with explanation ──────────

test("5: Reactivate is replaced with an explanation while preparation is active — the literal Reactivate button markup is only reachable via the !preparationActive branch", () => {
  const accountAccessBlock = detailSource.match(
    /\{d\.user\.accountStatus === "active" \? \([\s\S]*?<\/Card>\s*\n\s*\)\}/,
  );
  assert.ok(accountAccessBlock, "expected to find the Account Access Danger Zone block");
  assert.match(accountAccessBlock![0], /: !preparationActive \? \(/);
  assert.match(
    accountAccessBlock![0],
    /Reactivate Account is unavailable while deletion preparation is active\. Cancel deletion\s*\n\s*preparation first, then reactivate\./,
  );
});

// ─── 6: start confirmation copy says no deletion occurs ────────────────────

test("6: start confirmation modal explicitly says this does not permanently delete the account and no data is removed", () => {
  assert.match(detailSource, /Start deletion preparation\?/);
  assert.match(
    detailSource,
    /this does not permanently delete the account, and no\s*\n\s*data is removed\./,
  );
  assert.match(detailSource, /No\s*\n\s*financial or history data is deleted at this step\./);
});

// ─── 7: start success refetches lifecycle + impact ─────────────────────────

test("7: start success invalidates student-overview, students-list, and the deletion-impact query cache", () => {
  assert.match(detailSource, /async function invalidateAfterPreparationChange\(\) \{/);
  assert.match(
    detailSource,
    /invalidateAfterPreparationChange\(\) \{[\s\S]{0,400}queryKey: \["student-overview", studentId\][\s\S]{0,200}getListStudentsQueryKey\(\)[\s\S]{0,200}getGetStudentDeletionImpactQueryKey\(studentId\)/,
  );
  assert.match(
    detailSource,
    /const startPrepMutation = useStartStudentDeletionPreparation\(\{\s*mutation: \{\s*onSuccess: async \(\) => \{[\s\S]{0,200}await invalidateAfterPreparationChange\(\);/,
  );
});

// ─── 8: start 409 meaningful message ────────────────────────────────────────

test("8: start 409/conflict is surfaced via the real err.message, not a generic hardcoded string", () => {
  const startBlock = detailSource.match(
    /const startPrepMutation = useStartStudentDeletionPreparation\(\{[\s\S]*?\n  \}\);/,
  );
  assert.ok(startBlock, "expected to find startPrepMutation block");
  assert.match(startBlock![0], /setPrepError\(preparationErrorMessage\(err\) \|\| "Failed to start deletion preparation\. Please try again\."\);/);
  assert.match(detailSource, /function preparationErrorMessage\(err: unknown\): string \| undefined \{\s*return \(err as \{ message\?: string \} \| undefined\)\?\.message;/);
});

// ─── 9: start 403 handled ───────────────────────────────────────────────────

test("9: start 403 (and any other non-2xx) is handled by the same onError path, since ApiError carries status-derived messages via err.message", () => {
  const startBlock = detailSource.match(
    /const startPrepMutation = useStartStudentDeletionPreparation\(\{[\s\S]*?\n  \}\);/,
  );
  assert.ok(startBlock);
  assert.match(startBlock![0], /onError: \(err\) => \{/);
});

// ─── 10: start double-submit blocked ────────────────────────────────────────

test("10: Start Deletion Preparation button and its dialog action are disabled while a preparation mutation is pending", () => {
  assert.match(detailSource, /aria-label="Start Deletion Preparation"\s*\n\s*disabled=\{prepPending\}/);
  assert.match(
    detailSource,
    /<AlertDialogAction\s*\n\s*disabled=\{startPrepMutation\.isPending\}\s*\n\s*onClick=\{\(e\) => \{ e\.preventDefault\(\); confirmStartPrep\(\); \}\}/,
  );
  assert.match(detailSource, /function confirmStartPrep\(\) \{\s*if \(startPrepMutation\.isPending\) return;/);
});

// ─── 11: cancel confirmation says Student remains deactivated ──────────────

test("11: cancel confirmation modal explains the identity freeze is removed, the Student remains deactivated, and reactivation is a separate step", () => {
  assert.match(detailSource, /Cancel deletion preparation\?/);
  assert.match(detailSource, /This removes the identity freeze\./);
  assert.match(
    detailSource,
    /remains deactivated — cancelling deletion\s*\n\s*preparation does not reactivate the account\. Reactivation is a separate action afterward\./,
  );
});

// ─── 12: cancel success refetches lifecycle + impact ────────────────────────

test("12: cancel success also invalidates via the shared invalidateAfterPreparationChange helper", () => {
  assert.match(
    detailSource,
    /const cancelPrepMutation = useCancelStudentDeletionPreparation\(\{\s*mutation: \{\s*onSuccess: async \(\) => \{[\s\S]{0,200}await invalidateAfterPreparationChange\(\);/,
  );
});

// ─── 13: cancel 409 handled ──────────────────────────────────────────────────

test("13: cancel conflict/error is surfaced via err.message, not swallowed", () => {
  const cancelBlock = detailSource.match(
    /const cancelPrepMutation = useCancelStudentDeletionPreparation\(\{[\s\S]*?\n  \}\);/,
  );
  assert.ok(cancelBlock, "expected to find cancelPrepMutation block");
  assert.match(cancelBlock![0], /setPrepError\(preparationErrorMessage\(err\) \|\| "Failed to cancel deletion preparation\. Please try again\."\);/);
});

// ─── 14: cancel double-submit blocked ───────────────────────────────────────

test("14: Cancel Deletion Preparation button and dialog action are disabled while pending", () => {
  assert.match(detailSource, /aria-label="Cancel Deletion Preparation"\s*\n\s*disabled=\{prepPending\}/);
  assert.match(
    detailSource,
    /<AlertDialogAction\s*\n\s*disabled=\{cancelPrepMutation\.isPending\}\s*\n\s*onClick=\{\(e\) => \{ e\.preventDefault\(\); confirmCancelPrep\(\); \}\}/,
  );
  assert.match(detailSource, /function confirmCancelPrep\(\) \{\s*if \(cancelPrepMutation\.isPending\) return;/);
});

// ─── 15-18: RBAC ─────────────────────────────────────────────────────────────

test("15: Deletion Preparation card is gated by can('users','delete') — the same permission Permanent Account Deletion review already requires, no new permission introduced", () => {
  const prepCardMatch = detailSource.match(
    /\{can\("users", "delete"\) && d\.user\.accountStatus !== "deleted" && \(\s*<Card className="mt-6 border-red-500\/40">\s*<CardHeader className="pb-3">\s*<CardTitle className="flex items-center gap-2 text-sm text-red-400">\s*<AlertTriangle className="h-4 w-4" \/> Deletion Preparation/,
  );
  assert.ok(prepCardMatch, "expected the Deletion Preparation card to be gated by can('users','delete')");
});

test("16-17: prepStatusQuery (backing the visible preparation state) is gated only on can('users','delete'), not students.edit/parents.edit/users.edit", () => {
  const prepStatusBlock = detailSource.match(
    /const prepStatusQuery = useGetStudentDeletionImpact<StudentDeletionImpactResponse>\(studentId, \{[\s\S]*?\}\);/,
  );
  assert.ok(prepStatusBlock, "expected to find prepStatusQuery block");
  assert.match(prepStatusBlock![0], /enabled: can\("users", "delete"\) && Number\.isInteger\(studentId\) && studentId > 0,/);
  assert.doesNotMatch(prepStatusBlock![0], /can\(lifecycleModule, "edit"\)/);
  assert.doesNotMatch(prepStatusBlock![0], /can\("users", "edit"\)/);
});

test("18: Super Admin bypass is inherited from the same can() used elsewhere — not re-implemented for this feature", () => {
  const authSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/contexts/AdminAuthContext.tsx"),
    "utf8",
  );
  assert.match(authSource, /if \(user\.isSuperAdmin\) return true;/);
});

// ─── 19: impact review dialog displays preparation state safely ───────────

test("19: impact review dialog surfaces deletionPreparation.active/startedAt safely near the top, without altering the four existing classification groups", () => {
  assert.match(
    detailSource,
    /\{data\.deletionPreparation\.active && \(\s*<p className="text-xs font-medium text-amber-400">\s*Deletion preparation is currently active/,
  );
  // Still exactly the four original groups, untouched.
  assert.match(detailSource, /\{ key: "blocker", title: "Must Resolve First" \}/);
  assert.match(detailSource, /\{ key: "anonymize", title: "Will Be Anonymized" \}/);
  assert.match(detailSource, /\{ key: "retain", title: "Will Be Retained" \}/);
  assert.match(detailSource, /\{ key: "delete", title: "Will Be Deleted" \}/);
});

// ─── 20: no Permanent Delete action anywhere ────────────────────────────────

test("20: Permanent Delete exists in EXACTLY one place — the Deletion Impact dialog's own confirmed action — not duplicated into the Deletion Preparation card", () => {
  // Narrowed (not removed): Phase B3B4 legitimately introduces Permanent
  // Delete. This asserts it is not duplicated into the Deletion Preparation
  // card's own block (a different, pre-existing section of the page).
  const prepBlock = detailSource.match(
    /Deletion Preparation \(Phase B3B0-2B\)[\s\S]*?<\/Card>\n {10}\)\}/,
  );
  assert.ok(prepBlock, "Deletion Preparation card block not found");
  assert.doesNotMatch(prepBlock[0], /aria-label="Permanent Delete"/);
  const permanentDeleteButtons = (detailSource.match(/aria-label="Permanent Delete"/g) ?? []).length;
  assert.equal(permanentDeleteButtons, 1, "Permanent Delete action must exist in exactly one place");
});

// ─── 21: no raw email/fingerprint ever rendered for preparation state ──────

test("21: deletion-preparation status rendering never references a raw email, fingerprint, or secret/provenance field — only active/startedAt/status", () => {
  assert.doesNotMatch(detailSource, /deletionPrep(\?\.| \?\? null)?\.(email|fingerprint|secret|provenance)/i);
  assert.doesNotMatch(detailSource, /emailFingerprint|provenanceSecret/i);
  // The only fields ever pulled off deletionPreparation/deletionPrep.
  assert.match(detailSource, /deletionPrep\?\.active === true/);
  assert.match(detailSource, /deletionPrep\?\.startedAt/);
});

// ─── 22-23: existing suites remain unmodified ──────────────────────────────

test("22: studentAccountLifecycle.test.ts (B1D) file is unmodified by this feature", () => {
  const lifecycleTestSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/pages/studentAccountLifecycle.test.ts"),
    "utf8",
  );
  assert.match(lifecycleTestSource, /no reference to student id 34 was introduced by this feature/);
  assert.doesNotMatch(lifecycleTestSource, /deletion-preparation|deletionPreparation|Start Deletion Preparation/);
});

test("23: studentDeletionImpact.test.ts (B2C) file is unmodified by this feature", () => {
  const impactTestSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/pages/studentDeletionImpact.test.ts"),
    "utf8",
  );
  assert.match(impactTestSource, /Phase B2C — Admin Deletion Impact Review UI/);
  assert.doesNotMatch(impactTestSource, /Start Deletion Preparation|Cancel Deletion Preparation/);
});

// ─── 24: regression sanity — no duplicated Danger Zone, syntax intact ──────

test("24: exactly one Account Access Danger Zone card and exactly one Deletion Preparation card exist (no duplication)", () => {
  const dangerZoneTitleCount = (detailSource.match(/<AlertTriangle className="h-4 w-4" \/> Danger Zone/g) ?? []).length;
  const prepTitleCount = (detailSource.match(/<AlertTriangle className="h-4 w-4" \/> Deletion Preparation/g) ?? []).length;
  const permanentDeletionTitleCount = (detailSource.match(/<AlertTriangle className="h-4 w-4" \/> Permanent Account Deletion/g) ?? []).length;
  assert.equal(dangerZoneTitleCount, 1);
  assert.equal(prepTitleCount, 1);
  assert.equal(permanentDeletionTitleCount, 1);
  assert.match(detailSource, /export default function StudentDetailPage\(\)/);
});

test("24b: no reference to student id 34 was introduced by this feature", () => {
  const newCodeBlock = detailSource.slice(detailSource.indexOf("startStudentDeletionPreparation") === -1 ? 0 : detailSource.indexOf("useStartStudentDeletionPreparation"));
  assert.doesNotMatch(newCodeBlock, /\b34\b/);
});

// ─── 25: TypeScript/build — exercised by the practical-steps build run, not here ──

test("25: uses the real generated hooks for start/cancel, not a hand-rolled fetch or duplicated response types", () => {
  assert.match(detailSource, /useStartStudentDeletionPreparation\(\{/);
  assert.match(detailSource, /useCancelStudentDeletionPreparation\(\{/);
  assert.doesNotMatch(detailSource, /interface StudentDeletionPreparationResponse/);
});
