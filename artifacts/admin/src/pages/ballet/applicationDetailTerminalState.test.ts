/**
 * Source-inspection coverage for Phase 2 — Ballet Application Overview
 * operational actions + terminal-state enforcement. Same style as
 * financeBalletPaymentsReconciliation.test.ts / system-users.test.ts (this
 * app has no React component-rendering test harness, so existing frontend
 * coverage confirms expected code patterns are present in the real source
 * rather than mounting components).
 *
 * What this locks in:
 *  - isApplicationTerminal is derived from the canonical
 *    BALLET_TERMINAL_APPLICATION_STATUSES constant, not a second hand-typed
 *    status list.
 *  - Every progression action (Assign Level, Assign Group, Create Initial
 *    Payment, Confirm Payment, Adjust Expiry, Activate Application) is
 *    gated on !isApplicationTerminal somewhere in its enabling condition.
 *  - Existing permissions (ballet.applications:approve, ballet.payments:
 *    create/edit, finance:paymentsConfirm via the backend) are untouched —
 *    the terminal gate is additive, not a replacement for permission checks.
 *  - Overview shows a terminal banner for rejected/cancelled/withdrawn.
 *  - The backend hardening (BALLET_APPLICATION_TERMINAL) exists in
 *    adminBalletPayments.ts for both Confirm Payment and Adjust Expiry.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const applicationDetailSource = readFileSync(
  new URL("./ApplicationDetailPage.tsx", import.meta.url),
  "utf8",
);
const enrollmentTabSource = readFileSync(
  new URL("./application-detail/EnrollmentTab.tsx", import.meta.url),
  "utf8",
);
const paymentsTabSource = readFileSync(
  new URL("./application-detail/PaymentsSubscriptionTab.tsx", import.meta.url),
  "utf8",
);
const overviewTabSource = readFileSync(
  new URL("./application-detail/OverviewTab.tsx", import.meta.url),
  "utf8",
);
const sharedSource = readFileSync(
  new URL("./application-detail/shared.tsx", import.meta.url),
  "utf8",
);
const adminBalletPaymentsSource = readFileSync(
  new URL("../../../../api-server/src/routes/adminBalletPayments.ts", import.meta.url),
  "utf8",
);

// ─── Canonical terminal-status derivation ───────────────────────────────────

test("ApplicationDetailPage: TERMINAL_ACTION_STATUSES is derived from the canonical constant, not a hand-typed duplicate", () => {
  assert.match(
    applicationDetailSource,
    /import\s*\{[^}]*BALLET_TERMINAL_APPLICATION_STATUSES[^}]*\}\s*from\s*"@workspace\/api-zod"/s,
  );
  assert.match(
    applicationDetailSource,
    /const TERMINAL_ACTION_STATUSES = new Set<BalletApplicationStatus>\(BALLET_TERMINAL_APPLICATION_STATUSES\);/,
  );
  assert.doesNotMatch(
    applicationDetailSource,
    /const TERMINAL_ACTION_STATUSES = new Set<BalletApplicationStatus>\(\["rejected", "cancelled", "withdrawn"\]\);/,
  );
});

test("ApplicationDetailPage: isApplicationTerminal is computed once and threaded to every tab", () => {
  assert.match(applicationDetailSource, /const isApplicationTerminal = TERMINAL_ACTION_STATUSES\.has\(applicationStatus\);/);
  assert.match(applicationDetailSource, /isApplicationTerminal=\{isApplicationTerminal\}/);
});

// ─── Assign Level / Assign Group gating (the confirmed UI-only gap) ────────

test("ApplicationDetailPage: canAssignLevel/canAssignGroup require !isApplicationTerminal and mirror the backend allowlists", () => {
  assert.match(
    applicationDetailSource,
    /const canAssignLevel = Boolean\(canApprove && !isApplicationTerminal && \["accepted", "assignedToLevel"\]\.includes\(app\.status\)\);/,
  );
  assert.match(
    applicationDetailSource,
    /const canAssignGroup = Boolean\(canApprove && !isApplicationTerminal && levelAssigned && \["assignedToLevel", "active"\]\.includes\(app\.status\)\);/,
  );
});

test("EnrollmentTab: Assign Level card is hidden for terminal applications", () => {
  // Phase 2.2 grid pass moved the visibility check into a named
  // `hasLevelSection` boolean (rendered inside the shared Change
  // Level/Change Group GridRow) — same guard, same condition, just no
  // longer inlined directly on the JSX block.
  assert.match(
    enrollmentTabSource,
    /const hasLevelSection = canApprove && !isApplicationTerminal && levels\.length > 0;/,
  );
  assert.match(enrollmentTabSource, /\{hasLevelSection && \(/);
  // The action button itself only renders when canAssignLevel (which already
  // encodes !isApplicationTerminal) is true.
  assert.match(enrollmentTabSource, /\{canAssignLevel \? \(/);
});

test("EnrollmentTab: Assign Group card is hidden for terminal applications", () => {
  assert.match(enrollmentTabSource, /const hasGroupSection = canApprove && !isApplicationTerminal;/);
  assert.match(enrollmentTabSource, /\{hasGroupSection && \(/);
  assert.match(enrollmentTabSource, /canAssignGroup/);
});

test("EnrollmentTab: Activate Application is hidden for terminal applications", () => {
  assert.match(enrollmentTabSource, /\{!isApplicationTerminal && canActivateApplication && \(/);
});

// ─── Payment lifecycle gating ────────────────────────────────────────────────

test("ApplicationDetailPage: canCreateInitialPayment, canConfirmInitialPayment, canAdjustExpiry all require !isApplicationTerminal", () => {
  assert.match(applicationDetailSource, /const canAdjustExpiry = Boolean\(!isApplicationTerminal && canEditPayments/);
  assert.match(
    applicationDetailSource,
    /const canCreateInitialPayment = Boolean\(\s*!isApplicationTerminal\s*&& canCreatePayments/,
  );
  assert.match(
    applicationDetailSource,
    /const canConfirmInitialPayment = Boolean\(!isApplicationTerminal && canEditPayments && pendingInitialPayment\);/,
  );
});

test("ApplicationDetailPage: ballet.payments.create/edit permissions remain unchanged — only terminal-gated, not replaced", () => {
  assert.match(applicationDetailSource, /const canCreatePayments = can\("ballet\.payments", "create"\);/);
  assert.match(applicationDetailSource, /const canEditPayments = can\("ballet\.payments", "edit"\);/);
});

test("PaymentsSubscriptionTab: the Subscription Management Adjust Expiry button is hidden (not just disabled) for terminal applications", () => {
  assert.match(paymentsTabSource, /\{!isApplicationTerminal && canEditPayments && \(/);
});

// ─── Permission preservation: no stale ballet.payments.view reintroduced ───

test("ApplicationDetailPage: still does not gate payment-history visibility on the vestigial ballet.payments.view permission", () => {
  assert.doesNotMatch(applicationDetailSource, /can\("ballet\.payments",\s*"view"\)/);
});

// ─── Overview: six operational areas + terminal banner ─────────────────────

test("OverviewTab: renders all six operational readiness areas", () => {
  for (const label of [
    "Application Status",
    "Level Assignment",
    "Group Assignment",
    "Initial Payment",
    "Payment Confirmation",
    "Subscription",
  ]) {
    assert.match(overviewTabSource, new RegExp(`label="${label}"`), `expected a ReadinessItem for "${label}"`);
  }
});

test("OverviewTab: every operational action reuses the existing dialogs/mutations — no second implementation", () => {
  for (const reused of [
    "openStatusDecisionDialog",
    "openAssignLevelDialog",
    "openAssignGroupDialog",
    "openInitialPaymentDialog",
    "openConfirmPaymentDialog",
    "setAdjustExpiryOpen",
    "statusMutation.mutate",
  ]) {
    assert.ok(overviewTabSource.includes(reused), `expected OverviewTab to call the existing ${reused}`);
  }
  // No raw fetch()/new mutation inside the tab itself — everything routes
  // through props owned by the parent page.
  assert.doesNotMatch(overviewTabSource, /fetch\(/);
  assert.doesNotMatch(overviewTabSource, /useMutation/);
});

test("OverviewTab: shows a terminal banner with status-specific copy for rejected/cancelled/withdrawn", () => {
  assert.match(overviewTabSource, /\{isApplicationTerminal && \(/);
  for (const status of ["rejected", "cancelled", "withdrawn"]) {
    assert.match(overviewTabSource, new RegExp(`${status}:\\s*\\{`));
  }
});

test("OverviewTab: all six action areas are suppressed for a terminal application (isApplicationTerminal short-circuits every action)", () => {
  // Each of the six ReadinessItem action props opens with a ternary/OR whose
  // very first check is isApplicationTerminal, so a terminal application
  // always short-circuits straight to "no action" without evaluating any
  // permission/mutation logic underneath.
  const guardedActionCount = (overviewTabSource.match(/action=\{\s*\n\s*isApplicationTerminal/g) ?? []).length;
  assert.equal(guardedActionCount, 6, `expected all six action={...} props to open with isApplicationTerminal, found ${guardedActionCount}`);
});

// ─── shared.tsx: ReadinessItem exported with an action slot ────────────────

test("shared.tsx: ReadinessItem is exported and accepts an optional action slot", () => {
  assert.match(sharedSource, /export function ReadinessItem\(/);
  assert.match(sharedSource, /action\?:\s*ReactNode/);
  // The old read-only-only wrapper is gone — Overview composes ReadinessItem
  // directly now, so there is exactly one implementation of this UI, not two.
  assert.doesNotMatch(sharedSource, /export function ActivationReadiness/);
});

// ─── Backend hardening present (mirrors the route-integration tests) ───────

test("adminBalletPayments.ts: Confirm Payment rejects terminal applications with the stable BALLET_APPLICATION_TERMINAL code", () => {
  assert.match(adminBalletPaymentsSource, /import \{ BALLET_TERMINAL_APPLICATION_STATUSES \} from "@workspace\/api-zod";/);
  assert.match(
    adminBalletPaymentsSource,
    /Cannot confirm payment: application status "\$\{application\.status\}" is terminal\./,
  );
  assert.match(adminBalletPaymentsSource, /code:\s*"BALLET_APPLICATION_TERMINAL"/);
});

test("adminBalletPayments.ts: Adjust Expiry also rejects terminal applications with the same stable code", () => {
  assert.match(
    adminBalletPaymentsSource,
    /Cannot adjust subscription expiry: application status "\$\{application\.status\}" is terminal\./,
  );
  const terminalCodeCount = (adminBalletPaymentsSource.match(/code:\s*"BALLET_APPLICATION_TERMINAL"/g) ?? []).length;
  assert.equal(terminalCodeCount, 2, "expected exactly two BALLET_APPLICATION_TERMINAL rejections (confirm + adjust expiry)");
});

test("adminBalletPayments.ts: the non-terminal allowlists this hardening must not touch remain intact", () => {
  // Preferred behavior per the task: preserve existing valid non-terminal
  // behavior, do not introduce a new, more restrictive allowlist beyond what
  // already existed.
  assert.match(adminBalletPaymentsSource, /const INITIAL_PAYMENT_APPLICATION_STATUSES = \["accepted", "assignedToLevel"\] as const;/);
});
