/**
 * Source-inspection coverage for Phase B1D — Admin Deactivate/Reactivate UX
 * on the Student Detail page. Same style as
 * package-orders.refund-ux.test.ts / ballet/applicationDetailTerminalState.test.ts
 * (this app has no React component-rendering test harness, so existing
 * frontend coverage confirms expected code patterns are present in the real
 * source rather than mounting components).
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

// ─── Status display ─────────────────────────────────────────────────────────

test("student-detail: renders an AccountStatusBadge fed by accountStatus, with a distinct deleted state", () => {
  assert.match(detailSource, /accountStatus: "active" \| "deactivated" \| "deleted";/);
  assert.match(detailSource, /<AccountStatusBadge status=\{d\.user\.accountStatus\} \/>/);
  assert.match(detailSource, /deleted: "Deleted \/ unavailable"/);
});

test("students.tsx list: shows a compact non-active badge without a dedicated column, keyed off accountStatus", () => {
  assert.match(listSource, /accountStatus\?: "active" \| "deactivated" \| "deleted";/);
  assert.match(listSource, /student\.accountStatus && student\.accountStatus !== "active"/);
  assert.doesNotMatch(listSource, /<TableHead>Status<\/TableHead>/);
});

// ─── RBAC gating ─────────────────────────────────────────────────────────────

test("student-detail: Danger Zone reuses can(module, 'edit') / can('users','edit') — the same anyOf the backend enforces — not a new permission", () => {
  assert.match(
    detailSource,
    /\(can\(lifecycleModule, "edit"\) \|\| can\("users", "edit"\)\) && d\.user\.accountStatus !== "deleted"/,
  );
  assert.match(detailSource, /const lifecycleModule = isParent \? "parents" : "students";/);
});

test("student-detail: deleted accounts never render lifecycle controls, even if permission checks somehow passed", () => {
  assert.match(detailSource, /d\.user\.accountStatus !== "deleted"/);
});

// ─── Deactivate flow: confirmation, single-call, cache invalidation ────────

test("student-detail: Deactivate is button-then-dialog, not a one-click action", () => {
  assert.match(detailSource, /setDangerDialog\("deactivate"\)/);
  assert.match(detailSource, /open=\{dangerDialog === "deactivate"\}/);
  assert.match(detailSource, /AlertDialogTitle>Deactivate this account\?/);
});

test("student-detail: confirming deactivate calls useDeactivateStudent exactly once via confirmDeactivate, with an optional reason", () => {
  assert.match(detailSource, /const deactivateMutation = useDeactivateStudent\(/);
  assert.match(
    detailSource,
    /deactivateMutation\.mutate\(\{ id: studentId, data: reason \? \{ reason \} : undefined \}\);/,
  );
  assert.match(detailSource, /function confirmDeactivate\(\) \{\s*if \(deactivateMutation\.isPending\) return;/);
});

test("student-detail: cancelling the deactivate dialog does not call the mutation", () => {
  // AlertDialogCancel has no onClick wired to confirmDeactivate/mutate — only
  // AlertDialogAction is.
  assert.doesNotMatch(detailSource, /AlertDialogCancel[^>]*onClick=\{[^}]*confirmDeactivate/);
});

test("student-detail: deactivate button and dialog action are disabled while the mutation is pending (double-submit prevention)", () => {
  assert.match(detailSource, /aria-label="Deactivate account"\s*\n\s*disabled=\{lifecyclePending\}/);
  assert.match(detailSource, /<AlertDialogAction\s*\n\s*disabled=\{deactivateMutation\.isPending\}/);
});

test("student-detail: successful deactivate invalidates both the student-overview and students-list query caches", () => {
  assert.match(detailSource, /async function invalidateAfterLifecycleChange\(\) \{/);
  assert.match(detailSource, /queryKey: \["student-overview", studentId\]/);
  assert.match(detailSource, /getListStudentsQueryKey\(\)/);
  assert.match(detailSource, /onSuccess: async \(\) => \{[\s\S]{0,200}await invalidateAfterLifecycleChange\(\);/);
});

test("student-detail: deactivate failure surfaces an error and does not silently succeed", () => {
  assert.match(detailSource, /onError: \(err\) => \{\s*setLifecycleSuccess\(null\);/);
  assert.match(detailSource, /role="alert" className="text-sm text-destructive">\{lifecycleError\}/);
});

// ─── Reactivate flow ────────────────────────────────────────────────────────

test("student-detail: Reactivate is also confirm-gated and calls useReactivateStudent exactly once with no reason field", () => {
  assert.match(detailSource, /const reactivateMutation = useReactivateStudent\(/);
  assert.match(detailSource, /reactivateMutation\.mutate\(\{ id: studentId \}\);/);
  assert.match(detailSource, /AlertDialogTitle>Reactivate this account\?/);
  // No reason input inside the reactivate dialog block.
  const reactivateDialogMatch = detailSource.match(
    /open=\{dangerDialog === "reactivate"\}[\s\S]*?<\/AlertDialog>/,
  );
  assert.ok(reactivateDialogMatch, "expected to find the reactivate AlertDialog block");
  assert.doesNotMatch(reactivateDialogMatch![0], /<Textarea/);
});

test("student-detail: reactivate copy never claims devices/push auto-restore", () => {
  assert.match(
    detailSource,
    /Device push notifications are not\s*\n\s*automatically restored/,
  );
});

// ─── Idempotency / error handling ──────────────────────────────────────────

test("student-detail: lifecycle mutations surface backend error messages generically via err.message, not raw response internals", () => {
  const errorHandlerCount = (detailSource.match(/const message = \(err as \{ message\?: string \}\)\?\.message;/g) ?? []).length;
  assert.equal(errorHandlerCount, 2, "expected one error handler for deactivate and one for reactivate");
});

// ─── Permanent-delete absence ───────────────────────────────────────────────

test("student-detail and students.tsx: never call the disabled deleteStudent mutation", () => {
  assert.doesNotMatch(detailSource, /useDeleteStudent|deleteStudent\(/);
  assert.doesNotMatch(listSource, /useDeleteStudent|deleteStudent\(/);
});

test("no reference to student id 34 was introduced by this feature", () => {
  assert.doesNotMatch(detailSource, /\b34\b/);
  assert.doesNotMatch(listSource, /\b34\b/);
});
