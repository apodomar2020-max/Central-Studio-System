import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const migration = read("lib/db/migrations/0068_ballet_cancellations_refunds.sql");
const schema = read("lib/db/src/schema/balletEnrollmentCancellations.ts");
const routes = read("artifacts/api-server/src/routes/balletCancellationRefunds.ts");
const adminDetail = read("artifacts/api-server/src/routes/adminBallet.ts");
const eligibility = read("artifacts/api-server/src/lib/balletRefundEligibility.ts");

// ─── Initiator attribution model (migration + schema) ───────────────────────────

test("migration 0068 adds initiator attribution columns and a combination CHECK (edited in place, not a new migration)", () => {
  assert.match(migration, /initiated_by_type text NOT NULL DEFAULT 'parent'/);
  assert.match(migration, /initiated_by_admin_id integer REFERENCES system_users\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /ballet_enrollment_cancellation_initiator_combination_check CHECK \(\s*\n\s*\(initiated_by_type = 'parent' AND initiated_by_admin_id IS NULL\)\s*\n\s*OR\s*\n\s*\(initiated_by_type = 'admin' AND initiated_by_admin_id IS NOT NULL\)\s*\n\s*\)/);
});

test("migration no longer contains the weaker bare-enum initiator check", () => {
  assert.doesNotMatch(migration, /ballet_enrollment_cancellation_initiated_by_type_check CHECK \(initiated_by_type IN/);
});

test("drizzle schema mirrors the initiator columns (RESTRICT delete) and preserves parentStudentId", () => {
  assert.match(schema, /initiatedByType: text\("initiated_by_type"\)\.notNull\(\)\.default\("parent"\)/);
  assert.match(schema, /initiatedByAdminId: integer\("initiated_by_admin_id"\)\.references\(\(\) => systemUsersTable\.id, \{ onDelete: "restrict" \}\)/);
  assert.match(schema, /parentStudentId: integer\("parent_student_id"\)/);
  assert.match(schema, /ballet_enrollment_cancellation_initiator_combination_check/);
});

test("schema CHECK enforces the same combination rule as the migration", () => {
  assert.match(schema, /\$\{table\.initiatedByType\} = 'parent' and \$\{table\.initiatedByAdminId\} is null\) or \(\$\{table\.initiatedByType\} = 'admin' and \$\{table\.initiatedByAdminId\} is not null\)/);
});

// ─── Initiator set correctly per path ───────────────────────────────────────────

test("parent-created enrollment cancellation records initiatedByType parent", () => {
  assert.match(routes, /initiatedByType: "parent",\s*\n\s*initiatedByAdminId: null,/);
});

test("admin-initiated endpoint records initiatedByType admin with the acting admin id", () => {
  assert.match(routes, /request-cancellation/);
  assert.match(routes, /initiatedByType: "admin",\s*\n\s*initiatedByAdminId: adminId,/);
});

// ─── Admin-initiated active cancellation workflow (spec §7) ──────────────────────

test("admin-initiated endpoint is gated on ballet.applications cancel permission", () => {
  assert.match(routes, /request-cancellation", requireAdminAuth, requireAdminPermission\("ballet\.applications", "cancel"\)/);
});

test("admin-initiated endpoint requires an active application + active assignment", () => {
  assert.match(routes, /if \(app\.status !== "active"\) return \{ kind: "app_not_active" as const/);
  assert.match(routes, /if \(!assignment\) return \{ kind: "no_active_assignment" as const \}/);
});

test("admin-initiated endpoint prevents duplicate open requests", () => {
  assert.match(routes, /if \(open\) return \{ kind: "duplicate" as const, id: open\.id \}/);
  assert.match(routes, /res\.status\(409\)\.json\(\{ error: "An open cancellation request already exists for this enrollment\./);
});

test("immediate admin cancellation creates → approves → finalizes once via the shared finalizer", () => {
  assert.match(routes, /forceImmediate: true,\s*\n\s*auditActor: adminActivityActor\(req\),\s*\n\s*auditAction: "approveImmediate",/);
  assert.match(routes, /if \(finalized\.kind !== "completed"\) return \{ kind: "finalize_failed" as const/);
});

test("end-of-period admin cancellation approves and stores the effective date, keeping enrollment active", () => {
  assert.match(routes, /approvedTiming: parsed\.data\.requestedTiming,/);
  assert.match(routes, /approvedEffectiveDate: effectiveDate,/);
  assert.match(routes, /title: "Ballet cancellation scheduled",/);
  assert.match(routes, /action: "approveEndOfPeriod",/);
});

test("admin-initiated endpoint always inserts exactly one cancellation-request record", () => {
  const insertCount = (routes.match(/\.insert\(balletEnrollmentCancellationRequestsTable\)/g) ?? []).length;
  // one for the parent path, one for the admin-initiated path
  assert.equal(insertCount, 2);
});

// ─── Refund behavior (spec §8) ───────────────────────────────────────────────────

test("optional refund creates an underReview cash refund only (never bankTransfer/originalPaymentMethod)", () => {
  assert.match(routes, /const SUPPORTED_REFUND_METHOD = "cash" as const;/);
  assert.match(routes, /status: "underReview",\s*\n\s*refundMethod: SUPPORTED_REFUND_METHOD,/);
  assert.match(routes, /requestedAmountEgp: null,/); // parent/admin never enter an amount
});

test("admin refund approval rejects any non-cash method", () => {
  assert.match(routes, /if \(parsed\.data\.refundMethod !== "cash"\) \{ res\.status\(422\)\.json\(\{ error: "Only cash refunds/);
});

test("cash refund eligibility loads all paid payments (method-agnostic) so the current cycle can be found before checking its method", () => {
  assert.match(eligibility, /eq\(balletPaymentsTable\.status, "paid"\)/);
  // Deliberately NOT filtered by paymentMethod in SQL — selectActiveEnrollmentCyclePayment
  // must see the true current cycle regardless of method, then decide cash-eligibility itself.
  assert.doesNotMatch(eligibility, /eq\(balletPaymentsTable\.paymentMethod, "inPerson"\)/);
});

test("active-enrollment and pre-activation refund eligibility use two distinct, non-ambiguous selection primitives", () => {
  assert.match(eligibility, /resolveCurrentBalletCycle/);
  assert.match(eligibility, /selectPreActivationEligiblePayment/);
});

test("cancelPreActivationApplication uses the preActivation eligibility context, never activeEnrollment", () => {
  assert.match(routes, /eligibilityContext: \{ kind: "preActivation" \}/);
});

test("parent route resolves the current cycle ONCE via resolveApplicationCurrentCycle and reuses it for both effective-date derivation and refund eligibility — never two independent lookups", () => {
  assert.match(routes, /const resolvedCycle = await resolveApplicationCurrentCycle\(app\.id, today, tx as typeof db\);/);
  assert.match(routes, /const effectiveDate = isImmediate\s*\n\s*\? today\s*\n\s*: resolvedCycle\?\.subscriptionExpiresAt \?\? today;/);
  assert.match(routes, /eligibilityContext: \{ kind: "activeEnrollment", resolvedCycle \},/);
});

test("6. parent immediate cancellation still uses today, not any cycle-derived date", () => {
  assert.match(routes, /const isImmediate = parsed\.data\.requestedTiming === "immediate";\s*\n\s*const today = todayIso\(\);[\s\S]*?const effectiveDate = isImmediate\s*\n\s*\? today/);
});

test("Parent end-of-period effective date is derived via resolveApplicationCurrentCycle (date-window match), never balletSubscriptions.ts's currentSubscription() which has no concept of \"today\"", () => {
  assert.match(routes, /resolveApplicationCurrentCycle\(app\.id, today, tx as typeof db\)/);
});

test("parent route's requestedEffectiveDate is persisted at creation time from the SAME resolved cycle, establishing identity once so an admin approving later never has to re-resolve or guess", () => {
  assert.match(routes, /requestedEffectiveDate: isImmediate \? today : resolvedCycle\?\.subscriptionExpiresAt \?\? null,/);
});

test("admin-initiated immediate cancellation uses the initiation date as the effective date; end-of-period uses an explicit admin override or the resolved cycle's expiry", () => {
  assert.match(routes, /const effectiveDate = isImmediate\s*\n\s*\? initiationDate\s*\n\s*: parsed\.data\.approvedEffectiveDate\s*\n\s*\?\? resolvedCycle\?\.subscriptionExpiresAt\s*\n\s*\?\? initiationDate;/);
});

test("7. admin-provided/stored effective date takes precedence for STORAGE, but refund eligibility always evaluates the freshly-resolved cycle, never the (possibly admin-overridden) stored date", () => {
  // parsed.data.approvedEffectiveDate is the FIRST operand of the storage ??
  // chain, so an explicit admin override always wins for approvedEffectiveDate.
  assert.match(routes, /const effectiveDate = isImmediate\s*\n\s*\? initiationDate\s*\n\s*: parsed\.data\.approvedEffectiveDate\s*\n\s*\?\? resolvedCycle\?\.subscriptionExpiresAt/);
  // But refund eligibility below is keyed on resolvedCycle directly, not on
  // the (possibly overridden) effectiveDate — an arbitrary admin-typed date
  // never becomes a second payment-selection search key.
  assert.match(routes, /eligibilityContext: \{ kind: "activeEnrollment", resolvedCycle \},/);
});

test("both admin end-of-period call sites (request-cancellation, approve-end-of-period) no longer use currentSubscription() to derive an effective date", () => {
  assert.doesNotMatch(
    routes,
    /currentSubscription\(await getPaymentCyclesForApplication\(id\)\)/,
    "admin-initiated request-cancellation must no longer use currentSubscription() (no concept of today, can return a future renewal)",
  );
  assert.doesNotMatch(
    routes,
    /currentSubscription\(await getPaymentCyclesForApplication\(request\.applicationId\)\)/,
    "approve-end-of-period must no longer use currentSubscription() (no concept of today, can return a future renewal)",
  );
});

test("approve-end-of-period prefers stored identity (admin override, then requestedEffectiveDate established at creation time) over recomputing from latest payment; falls back to resolving on the REQUEST's own creation date, never approval-day today", () => {
  assert.match(routes, /const effectiveDate = parsed\.data\.approvedEffectiveDate\s*\n\s*\?\? request\.requestedEffectiveDate\s*\n\s*\?\? \(request\.applicationId\s*\n\s*\? \(await resolveApplicationCurrentCycle\(request\.applicationId, todayDateOnly\(new Date\(request\.createdAt\)\), tx as typeof db\)\)\?\.subscriptionExpiresAt/);
});

// ─── Admin detail surfaces attribution + refund eligibility ──────────────────────

test("admin application detail returns initiator names and refund eligibility summary", () => {
  assert.match(adminDetail, /initiatedByAdminName: r\.initiatedByAdminId != null \? initiatorNameById\.get\(r\.initiatedByAdminId\) \?\? null : null/);
  assert.match(adminDetail, /const eligibleRefund = await balletRefundEligibilitySummary\(id, refundEligibilityContext\)/);
  assert.match(adminDetail, /cancellationRequests: cancellationRequestsWithInitiator,/);
  assert.match(adminDetail, /eligibleRefund,/);
});

// ─── assignedToLevel cancellation preserves assignment history (spec §1) ─────────

test("pre-activation cancel withdraws (never deletes) an assignedToLevel assignment", () => {
  assert.match(routes, /status: "withdrawn",\s*\n\s*withdrawnAt: now,/);
  assert.doesNotMatch(routes, /\.delete\(balletLevelAssignmentsTable\)/);
});
