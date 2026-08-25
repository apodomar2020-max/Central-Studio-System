/**
 * Student Permanent Account Deletion — Phase B2B: read-only deletion impact.
 *
 * ZERO WRITES. This module only ever SELECTs. No audit row, no OTP change,
 * no device mutation, no student mutation, no booking/package/payment
 * mutation happens here or in the route that calls it. See
 * students.deletionImpact.integration.test.ts's zero-write regression test
 * for the enforced proof.
 *
 * ADVISORY ONLY. This impact analysis reflects current-state information at
 * `generatedAt` under `policyVersion`. It is NOT a concurrency token, NOT a
 * signed confirmation, and NOT authoritative for a future Permanent Delete
 * execution (Phase B4). B4 MUST recompute its own full blocker set inside
 * its own locked transaction before ever mutating or removing a Student row.
 * A client-supplied `canDelete: true` must never be trusted — this GET
 * accepts no request body, so no such value can even be supplied to it.
 *
 * FINANCIAL DATA-GRAPH CORRECTION (Phase B2B, closing a B2A gap):
 * The schema doc-comments on payment_records / payment_events /
 * payment_refunds describe them as a "dark register" with "no writer
 * exists yet". That is now STALE. Live writers exist:
 *   - artifacts/api-server/src/routes/bookings.ts (single_class_booking /
 *     studio_walkin payment_records rows)
 *   - artifacts/api-server/src/routes/packageOrders.ts (package_purchase
 *     payment_records rows)
 *   - artifacts/api-server/src/lib/checkInService.ts
 *   - artifacts/api-server/src/lib/financeBackfillWriter.ts (historical
 *     backfill rows)
 *   - artifacts/api-server/src/lib/packageRefundService.ts, driven by
 *     artifacts/api-server/src/routes/packageRefunds.ts — this is a live,
 *     transactional writer of payment_refunds rows (request / approve /
 *     reject / complete / fail), not a dark table.
 * This module therefore treats payment_records and payment_refunds as live
 * financial state and includes them in blocker computation (see
 * queryPaymentImpact below).
 *
 * PACKAGE CREDIT LOTS CORRECTION (Phase B3 prep, closing a B2B gap): the
 * previous version of this comment claimed package_credit_lots has "no
 * writer anywhere in the repo". That was stale. Live writers exist:
 *   - artifacts/api-server/src/routes/adminCredits.ts (manual admin credit
 *     adjustments — inserts/updates packageCreditLotsTable rows)
 *   - artifacts/api-server/src/lib/attendanceReversalService.ts (restores a
 *     lot on booking/attendance reversal)
 *   - artifacts/api-server/src/lib/packageCreditExpiration.ts (expires lots)
 *   - artifacts/api-server/src/routes/packageOrders.ts (creates the initial
 *     lot on activation)
 * This module still does NOT query package_credit_lots directly, and that
 * remains correct: every one of the writers above updates
 * packageOrders.remainingCredits in the SAME db.transaction as the
 * packageCreditLots write (verified by reading each writer), and
 * packageCreditExpiration.ts/attendanceReversalService.ts additionally
 * assert `lotCredits === order.remainingCredits` as an integrity check
 * before writing. packageOrders.ts's bare status-flip path is explicitly
 * guarded to reject cancelling anything but a never-activated
 * (pendingPayment) order specifically to avoid a credit-lot desync — see
 * the comment above that guard. So packageOrders.status/remainingCredits
 * remains a reliable proxy for package_credit_lots state, and this module's
 * decision to derive its blocker from remainingCredits rather than
 * package_credit_lots directly is still correct.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const DELETION_IMPACT_POLICY_VERSION = "1";

export type LifecycleStatus = "active" | "deactivated" | "deleted";

export type DeletionBlockerCategory =
  | "ACCOUNT_MUST_BE_DEACTIVATED"
  | "FUTURE_BOOKINGS"
  | "PENDING_BOOKING_PAYMENT"
  | "ACTIVE_PACKAGE_VALUE"
  | "PENDING_PACKAGE_ORDER"
  | "OPEN_REFUND"
  | "ACTIVE_BALLET_ENROLLMENT"
  | "OPEN_BALLET_APPLICATION"
  | "PENDING_BALLET_PAYMENT"
  | "OPEN_BALLET_CANCELLATION_REVIEW"
  | "CHILD_FUTURE_COMMITMENT"
  | "AMBIGUOUS_LEGACY_ATTRIBUTION"
  | "LEGACY_IDENTITY_BACKFILL_REQUIRED";

export interface DeletionBlocker {
  key: DeletionBlockerCategory;
  label: string;
  description: string;
  count?: number;
}

export interface DeletionImpactCategory {
  key: DeletionBlockerCategory | "OK";
  label: string;
  classification: "delete" | "anonymize" | "retain" | "blocker";
}

export interface DeletionImpactSummary {
  bookings: { historical: number; future: number };
  payments: { completed: number; pending: number; openRefunds: number };
  packages: { active: number; expired: number; unusedCredits: number; pendingOrders: number };
  children: { total: number; withFutureActivity: number };
  ballet: {
    applicationsOpen: number;
    applicationsTerminal: number;
    enrollmentsActive: number;
    paymentsPending: number;
    refundsOpen: number;
    cancellationsPendingReview: number;
  };
  security: { devices: number; otpChallenges: number; providerLinks: number };
  legacyAttribution: { emailOnlyRows: number; ambiguousRows: number };
}

export interface DeletionImpactResult {
  studentId: number;
  lifecycleStatus: LifecycleStatus;
  canDelete: boolean;
  generatedAt: string;
  policyVersion: string;
  blockers: DeletionBlocker[];
  summary: DeletionImpactSummary;
  categories: DeletionImpactCategory[];
}

export type DeletionImpactOutcome =
  | { kind: "notFound" }
  | { kind: "alreadyDeleted" }
  | { kind: "ok"; result: DeletionImpactResult };

const CAIRO_TODAY = sql`(now() AT TIME ZONE 'Africa/Cairo')::date`;

// Open/non-terminal ballet application statuses (BALLET_APPLICATION_STATUSES
// in lib/api-zod/src/ballet.ts): pending, accepted, needsFollowUp,
// assignedToLevel, active are open/operational; rejected, cancelled,
// withdrawn are terminal.
const BALLET_APPLICATION_OPEN = ["pending", "accepted", "needsFollowUp", "assignedToLevel", "active"];
// BALLET_PAYMENT_STATUSES: pending, rejected, paid, refunded — "pending" is
// the only non-terminal state.
const BALLET_PAYMENT_PENDING = ["pending"];
// BALLET_REFUND_STATUSES / PAYMENT_REFUND_STATUSES share the same shape:
// underReview, approved, processing are open; rejected, refunded, failed
// are terminal.
const REFUND_OPEN = ["underReview", "approved", "processing"];
// BALLET_LEVEL_ASSIGNMENT_STATUSES: active is the only "currently enrolled"
// state; paused/graduated/withdrawn are not currently-active commitments.
const BALLET_ENROLLMENT_ACTIVE = ["active"];
// BALLET_ENROLLMENT_CANCELLATION_STATUSES: pendingReview is the only open
// review state that still needs Admin action before it settles.
const BALLET_CANCELLATION_OPEN = ["pendingReview"];
// PAYMENT_RECORD_STATUSES: unpaid / pending_confirmation are non-terminal
// (still awaiting money or confirmation). paid/partially_refunded/refunded/
// waived/failed/cancelled/legacy_unverified are all settled/terminal for
// blocking purposes (legacy_unverified is historical-only, never a live
// obligation — it can never become "paid" per its own CHECK constraint).
const PAYMENT_RECORD_PENDING = ["unpaid", "pending_confirmation"];
// PACKAGE_ORDER statuses actually used by packageOrders.ts: pendingPayment
// is the only non-terminal state; active/cancelled/expired are settled.
const PACKAGE_ORDER_PENDING = ["pendingPayment"];

interface Row { [key: string]: unknown }

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

async function one<T = Row>(executor: Executor, query: any): Promise<T> {
  const result = await (executor as typeof db).execute(query);
  return (result.rows[0] ?? {}) as T;
}

/**
 * Runs the full read-only impact analysis for one student.
 *
 * Query architecture: a fixed, small set of bounded aggregate queries (one
 * per data domain), never per-row/per-child. Documented total below and
 * exercised by a query-count assertion in the integration test.
 *
 *   1. student row lookup
 *   2. bookings aggregate (self)
 *   3. payment_records + payment_refunds aggregate (self, via bookings +
 *      package_orders + direct student_id)
 *   4. package_orders aggregate (self)
 *   5. children aggregate + child future-activity aggregate (bounded GROUP
 *      BY over children, not one query per child)
 *   6. ballet aggregate (applications/payments/level assignments/
 *      cancellations, self + owned children, one query per ballet table —
 *      5 queries, each a single aggregate over all rows for this student)
 *   7. security artifacts aggregate (devices/otp/provider links)
 *   8. legacy email-ownership aggregate (bookings/package_orders/
 *      attendance/credit_transactions/feedback — 5 aggregate queries)
 *
 * Total: ~19 bounded aggregate queries, zero of which scale with the number
 * of the student's children/bookings/payments (all are COUNT/SUM/EXISTS
 * aggregates over a WHERE-scoped set). See
 * studentDeletionImpact.queryCount.integration.test.ts for the exact
 * instrumented count on a real run.
 */
export async function computeStudentDeletionImpact(studentId: number, executor: Executor = db): Promise<DeletionImpactOutcome> {
  const student = await one<{ id: number; account_status: string; email: string }>(executor, sql`
    SELECT id, account_status, email FROM students WHERE id = ${studentId} LIMIT 1
  `);
  if (student.id === undefined) return { kind: "notFound" };
  if (student.account_status === "deleted") return { kind: "alreadyDeleted" };

  const lifecycleStatus = student.account_status as LifecycleStatus;
  const normalizedEmail = sql`lower(trim(${student.email}))`;

  // ── 2. Bookings ──────────────────────────────────────────────────────
  const bookingsAgg = await one<{ historical: string; future: string }>(executor, sql`
    SELECT
      count(*) FILTER (WHERE occurrence_date IS NULL OR occurrence_date < ${CAIRO_TODAY}) AS historical,
      count(*) FILTER (
        WHERE occurrence_date IS NOT NULL AND occurrence_date >= ${CAIRO_TODAY}
          AND booking_status IN ('pending','confirmed')
      ) AS future
    FROM bookings WHERE account_owner_student_id = ${studentId}
  `);

  // ── 3. Payments / refunds ───────────────────────────────────────────
  const paymentsAgg = await one<{ completed: string; pending: string; pending_booking: string; pending_package: string }>(executor, sql`
    SELECT
      count(*) FILTER (WHERE status NOT IN ('unpaid','pending_confirmation')) AS completed,
      count(*) FILTER (WHERE status IN ('unpaid','pending_confirmation')) AS pending,
      count(*) FILTER (WHERE status IN ('unpaid','pending_confirmation') AND flow_type IN ('single_class_booking','studio_walkin')) AS pending_booking,
      count(*) FILTER (WHERE status IN ('unpaid','pending_confirmation') AND flow_type = 'package_purchase') AS pending_package
    FROM payment_records WHERE student_id = ${studentId}
  `);
  const refundsAgg = await one<{ open: string }>(executor, sql`
    SELECT count(*) AS open
    FROM payment_refunds pr
    JOIN payment_records pmr ON pmr.id = pr.payment_record_id
    WHERE pmr.student_id = ${studentId} AND pr.status IN (${sql.join(REFUND_OPEN.map((s) => sql`${s}`), sql`,`)})
  `);

  // ── 4. Package orders ────────────────────────────────────────────────
  const packagesAgg = await one<{ active: string; expired: string; unused_credits: string; pending: string }>(executor, sql`
    SELECT
      count(*) FILTER (WHERE status = 'active') AS active,
      count(*) FILTER (WHERE status = 'expired') AS expired,
      coalesce(sum(remaining_credits) FILTER (WHERE status = 'active'), 0) AS unused_credits,
      count(*) FILTER (WHERE status IN (${sql.join(PACKAGE_ORDER_PENDING.map((s) => sql`${s}`), sql`,`)})) AS pending
    FROM package_orders WHERE student_id = ${studentId}
  `);

  // ── 5. Children ──────────────────────────────────────────────────────
  const childrenAgg = await one<{ total: string; with_future: string }>(executor, sql`
    WITH kids AS (SELECT id FROM children WHERE parent_id = ${studentId})
    SELECT
      (SELECT count(*) FROM kids) AS total,
      (SELECT count(DISTINCT k.id) FROM kids k WHERE
        EXISTS (SELECT 1 FROM bookings b WHERE b.participant_child_id = k.id
          AND b.occurrence_date IS NOT NULL AND b.occurrence_date >= ${CAIRO_TODAY}
          AND b.booking_status IN ('pending','confirmed'))
        OR EXISTS (SELECT 1 FROM package_orders po WHERE po.participant_child_id = k.id
          AND po.status IN (${sql.join(PACKAGE_ORDER_PENDING.map((s) => sql`${s}`), sql`,`)}))
        OR EXISTS (SELECT 1 FROM ballet_applications ba WHERE ba.child_id = k.id
          AND ba.status IN (${sql.join(BALLET_APPLICATION_OPEN.map((s) => sql`${s}`), sql`,`)}))
        OR EXISTS (SELECT 1 FROM ballet_level_assignments bla WHERE bla.child_id = k.id
          AND bla.status IN (${sql.join(BALLET_ENROLLMENT_ACTIVE.map((s) => sql`${s}`), sql`,`)}))
      ) AS with_future
  `);

  // ── 6. Ballet (self via parent_student_id + owned children via child_id) ─
  const balletAppsAgg = await one<{ open: string; terminal: string }>(executor, sql`
    SELECT
      count(*) FILTER (WHERE status IN (${sql.join(BALLET_APPLICATION_OPEN.map((s) => sql`${s}`), sql`,`)})) AS open,
      count(*) FILTER (WHERE status NOT IN (${sql.join(BALLET_APPLICATION_OPEN.map((s) => sql`${s}`), sql`,`)})) AS terminal
    FROM ballet_applications
    WHERE parent_student_id = ${studentId}
       OR child_id IN (SELECT id FROM children WHERE parent_id = ${studentId})
  `);
  const balletEnrollAgg = await one<{ active: string }>(executor, sql`
    SELECT count(*) AS active FROM ballet_level_assignments bla
    JOIN ballet_applications app ON app.id = bla.application_id
    WHERE bla.status IN (${sql.join(BALLET_ENROLLMENT_ACTIVE.map((s) => sql`${s}`), sql`,`)})
      AND (app.parent_student_id = ${studentId} OR bla.child_id IN (SELECT id FROM children WHERE parent_id = ${studentId}))
  `);
  const balletPaymentsAgg = await one<{ pending: string }>(executor, sql`
    SELECT count(*) AS pending FROM ballet_payments bp
    JOIN ballet_applications app ON app.id = bp.application_id
    WHERE bp.status IN (${sql.join(BALLET_PAYMENT_PENDING.map((s) => sql`${s}`), sql`,`)})
      AND (app.parent_student_id = ${studentId} OR app.child_id IN (SELECT id FROM children WHERE parent_id = ${studentId}))
  `);
  const balletRefundsAgg = await one<{ open: string }>(executor, sql`
    SELECT count(*) AS open FROM ballet_refunds br
    JOIN ballet_applications app ON app.id = br.application_id
    WHERE br.status IN (${sql.join(REFUND_OPEN.map((s) => sql`${s}`), sql`,`)})
      AND (app.parent_student_id = ${studentId} OR app.child_id IN (SELECT id FROM children WHERE parent_id = ${studentId}))
  `);
  const balletCancelAgg = await one<{ pending: string }>(executor, sql`
    SELECT count(*) AS pending FROM ballet_enrollment_cancellation_requests
    WHERE status IN (${sql.join(BALLET_CANCELLATION_OPEN.map((s) => sql`${s}`), sql`,`)})
      AND (parent_student_id = ${studentId} OR child_id IN (SELECT id FROM children WHERE parent_id = ${studentId}))
  `);

  // ── 7. Security artifacts ───────────────────────────────────────────
  const securityAgg = await one<{ devices: string; otp: string; providers: string }>(executor, sql`
    SELECT
      (SELECT count(*) FROM notification_devices WHERE student_id = ${studentId} AND is_active = true) AS devices,
      (SELECT count(*) FROM email_otps WHERE student_id = ${studentId} AND used_at IS NULL AND expires_at > now()) AS otp,
      (SELECT count(*) FROM students WHERE id = ${studentId}
        AND (google_id IS NOT NULL OR apple_id IS NOT NULL OR facebook_id IS NOT NULL)) AS providers_flag
  `);
  const providerCount = await one<{ n: string }>(executor, sql`
    SELECT
      (CASE WHEN google_id IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN apple_id IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN facebook_id IS NOT NULL THEN 1 ELSE 0 END) AS n
    FROM students WHERE id = ${studentId}
  `);

  // ── 8. Legacy email-ownership analysis ──────────────────────────────
  // Classification (per resolveMemberIdentity's identity model):
  //  - explicit student_id ownership: not counted here at all (already
  //    covered above via the direct FK aggregates).
  //  - uniquely email-attributable legacy row: student_id/account_owner
  //    is NULL but exactly one student's normalized email matches this
  //    row's stored email — LEGACY_IDENTITY_BACKFILL_REQUIRED.
  //  - ambiguous: more than one student shares that normalized email
  //    (should not happen given students.email is UNIQUE, but a legacy
  //    row's stored email string may not equal any current student's
  //    email exactly while still textually colliding after
  //    normalization with more than one row in rare historical data —
  //    modeled defensively, never assumed impossible).
  //  - unattributable: no student matches at all — informational only,
  //    excluded from both counts, never crashes.
  const legacyBookings = await one<{ email_only: string }>(executor, sql`
    SELECT count(*) AS email_only FROM bookings
    WHERE account_owner_student_id IS NULL AND lower(trim(student_email)) = ${normalizedEmail}
  `);
  const legacyPackageOrders = await one<{ email_only: string }>(executor, sql`
    SELECT count(*) AS email_only FROM package_orders
    WHERE student_id IS NULL AND lower(trim(student_email)) = ${normalizedEmail}
  `);
  const legacyAttendance = await one<{ email_only: string }>(executor, sql`
    SELECT count(*) AS email_only FROM attendance
    WHERE student_id IS NULL
  `);
  const legacyCreditTx = await one<{ email_only: string }>(executor, sql`
    SELECT count(*) AS email_only FROM credit_transactions WHERE student_id IS NULL
  `);
  const legacyFeedback = await one<{ email_only: string }>(executor, sql`
    SELECT count(*) AS email_only FROM feedback
    WHERE student_id IS NULL AND lower(trim(student_email_snapshot)) = ${normalizedEmail}
  `);
  // Ambiguity check: does this normalized email match more than one
  // student row? (students.email is UNIQUE at the DB level, so this is
  // always 0 or 1 today — kept as an explicit, defensive check rather than
  // assumed, per the brief's "malformed/unattributable legacy data must
  // not crash" requirement.)
  const emailMatches = await one<{ n: string }>(executor, sql`
    SELECT count(*) AS n FROM students WHERE lower(trim(email)) = ${normalizedEmail}
  `);
  const isAmbiguousIdentity = Number(emailMatches.n ?? "0") > 1;

  const emailOnlyRows =
    Number(legacyBookings.email_only ?? "0") +
    Number(legacyPackageOrders.email_only ?? "0") +
    Number(legacyFeedback.email_only ?? "0");
  // attendance/credit_transactions have no email column to attribute by —
  // their NULL-studentId rows are unattributable, not email-attributable;
  // reported separately as ambiguous/unattributable signal rather than
  // silently folded into emailOnlyRows.
  // attendance/credit_transactions NULL-studentId rows have no email column
  // to attribute by — they are unattributable, not ambiguous, and are
  // intentionally excluded from every count above (never crashes, never
  // silently miscounted as either email-only or ambiguous).
  void legacyAttendance;
  void legacyCreditTx;
  const ambiguousRows = isAmbiguousIdentity ? emailOnlyRows : 0;

  // ── Assemble blockers ────────────────────────────────────────────────
  const blockers: DeletionBlocker[] = [];
  if (lifecycleStatus !== "deactivated") {
    blockers.push({
      key: "ACCOUNT_MUST_BE_DEACTIVATED",
      label: "Account must be deactivated",
      description: "The account must be in a deactivated state before permanent deletion can be considered.",
    });
  }

  const futureBookings = Number(bookingsAgg.future ?? "0");
  if (futureBookings > 0) {
    blockers.push({ key: "FUTURE_BOOKINGS", label: "Future bookings", description: "Student has upcoming confirmed or pending bookings.", count: futureBookings });
  }
  const pendingBookingPayment = Number(paymentsAgg.pending_booking ?? "0");
  if (pendingBookingPayment > 0) {
    blockers.push({ key: "PENDING_BOOKING_PAYMENT", label: "Pending booking payment", description: "A booking-related payment is unpaid or awaiting confirmation.", count: pendingBookingPayment });
  }
  const pendingPackagePayment = Number(paymentsAgg.pending_package ?? "0");
  const pendingPackageOrders = Number(packagesAgg.pending ?? "0");
  const pendingPackageTotal = pendingPackagePayment + pendingPackageOrders;
  if (pendingPackageTotal > 0) {
    blockers.push({ key: "PENDING_PACKAGE_ORDER", label: "Pending package order", description: "A package order is awaiting payment confirmation.", count: pendingPackageTotal });
  }
  const unusedCredits = Number(packagesAgg.unused_credits ?? "0");
  if (unusedCredits > 0) {
    blockers.push({
      key: "ACTIVE_PACKAGE_VALUE",
      label: "Active unused package value",
      description: "Resolve remaining package value before permanent deletion.",
      count: unusedCredits,
    });
  }
  const openRefunds = Number(refundsAgg.open ?? "0");
  if (openRefunds > 0) {
    blockers.push({ key: "OPEN_REFUND", label: "Open refund", description: "A payment refund is under review, approved, or processing.", count: openRefunds });
  }
  const balletOpenApps = Number(balletAppsAgg.open ?? "0");
  if (balletOpenApps > 0) {
    blockers.push({ key: "OPEN_BALLET_APPLICATION", label: "Open ballet application", description: "A ballet application is still open (not yet in a terminal state).", count: balletOpenApps });
  }
  const balletActiveEnroll = Number(balletEnrollAgg.active ?? "0");
  if (balletActiveEnroll > 0) {
    blockers.push({ key: "ACTIVE_BALLET_ENROLLMENT", label: "Active ballet enrollment", description: "A child has an active ballet level assignment.", count: balletActiveEnroll });
  }
  const balletPendingPayments = Number(balletPaymentsAgg.pending ?? "0");
  if (balletPendingPayments > 0) {
    blockers.push({ key: "PENDING_BALLET_PAYMENT", label: "Pending ballet payment", description: "A ballet payment is pending.", count: balletPendingPayments });
  }
  const balletOpenRefunds = Number(balletRefundsAgg.open ?? "0");
  if (balletOpenRefunds > 0) {
    blockers.push({ key: "OPEN_REFUND", label: "Open ballet refund", description: "A ballet refund is under review, approved, or processing.", count: balletOpenRefunds });
  }
  const balletCancelPending = Number(balletCancelAgg.pending ?? "0");
  if (balletCancelPending > 0) {
    blockers.push({ key: "OPEN_BALLET_CANCELLATION_REVIEW", label: "Open ballet cancellation review", description: "A ballet enrollment cancellation request is pending review.", count: balletCancelPending });
  }
  const childrenWithFuture = Number(childrenAgg.with_future ?? "0");
  if (childrenWithFuture > 0) {
    blockers.push({ key: "CHILD_FUTURE_COMMITMENT", label: "Child future commitment", description: "One or more children have a future booking, pending package, or open ballet commitment.", count: childrenWithFuture });
  }
  if (ambiguousRows > 0) {
    blockers.push({ key: "AMBIGUOUS_LEGACY_ATTRIBUTION", label: "Ambiguous legacy attribution", description: "Legacy rows could not be uniquely attributed to this account.", count: ambiguousRows });
  }
  if (emailOnlyRows > 0 && !isAmbiguousIdentity) {
    blockers.push({
      key: "LEGACY_IDENTITY_BACKFILL_REQUIRED",
      label: "Legacy identity backfill required",
      description: "Legacy rows are attributable to this account only via email and have not yet been backfilled with an explicit ownership link.",
      count: emailOnlyRows,
    });
  }

  const canDelete = lifecycleStatus === "deactivated" && blockers.length === 0;

  const categories: DeletionImpactCategory[] = blockers.length === 0
    ? [{ key: "OK", label: "No blockers", classification: "delete" }]
    : blockers.map((b) => ({ key: b.key, label: b.label, classification: "blocker" as const }));

  const result: DeletionImpactResult = {
    studentId,
    lifecycleStatus,
    canDelete,
    generatedAt: new Date().toISOString(),
    policyVersion: DELETION_IMPACT_POLICY_VERSION,
    blockers,
    summary: {
      bookings: { historical: Number(bookingsAgg.historical ?? "0"), future: futureBookings },
      payments: { completed: Number(paymentsAgg.completed ?? "0"), pending: Number(paymentsAgg.pending ?? "0"), openRefunds },
      packages: {
        active: Number(packagesAgg.active ?? "0"),
        expired: Number(packagesAgg.expired ?? "0"),
        unusedCredits,
        pendingOrders: pendingPackageOrders,
      },
      children: { total: Number(childrenAgg.total ?? "0"), withFutureActivity: childrenWithFuture },
      ballet: {
        applicationsOpen: balletOpenApps,
        applicationsTerminal: Number(balletAppsAgg.terminal ?? "0"),
        enrollmentsActive: balletActiveEnroll,
        paymentsPending: balletPendingPayments,
        refundsOpen: balletOpenRefunds,
        cancellationsPendingReview: balletCancelPending,
      },
      security: {
        devices: Number(securityAgg.devices ?? "0"),
        otpChallenges: Number(securityAgg.otp ?? "0"),
        providerLinks: Number(providerCount.n ?? "0"),
      },
      legacyAttribution: { emailOnlyRows, ambiguousRows },
    },
    categories,
  };

  return { kind: "ok", result };
}

/**
 * Phase B3B2E — Level-B manual-resolution deletion blocking.
 *
 * Binding policy — an unresolved Level-B legacy candidate inside a student's
 * canonical deletion plan BLOCKS deletion for that student. "Unresolved"
 * covers all three shapes, through this one blocker path:
 *
 *   • no decision row recorded at all      (status NONE)   → BLOCK
 *   • an explicit UNRESOLVED decision                      → BLOCK
 *   • a cross-signal EVIDENCE_CONFLICT                     → BLOCK
 *
 * and the resolved states clear it:
 *
 *   • PROVEN_OWNER      → no longer blocks (ownership backfill is separate)
 *   • NOT_THIS_STUDENT  → no longer blocks for THIS student
 *
 * `computeManualResolutionBlockSummary` already folds conflict rows into
 * `unresolvedCount`, so `unresolvedCount` is the single, complete trigger;
 * `conflictCount` remains only as additive observability. Leaving
 * `canDelete` true while any Level-B row is unresolved would advertise a
 * deletable account whose legacy ownership is not actually established.
 * Fail-closed.
 *
 * Deliberately reuses the EXISTING `AMBIGUOUS_LEGACY_ATTRIBUTION` blocker
 * key — an unresolved Level-B row is exactly "legacy rows could not be
 * uniquely attributed to this account" — so no new key is introduced into
 * the published OpenAPI blocker enum and no generated client changes.
 *
 * Pure function over an already-computed impact result; no queries, no
 * writes, no deletion capability added.
 */
export function applyManualResolutionBlocker(
  result: DeletionImpactResult,
  manualResolution: { unresolvedCount: number; conflictCount: number },
): DeletionImpactResult {
  if (manualResolution.unresolvedCount <= 0) return result;
  const description = manualResolution.conflictCount > 0
    ? "Legacy rows could not be uniquely attributed to this account. At least one row's email provenance and its independent check-in/credit evidence disagree on the owning student. These must be resolved before permanent deletion can be considered."
    : "Legacy rows could not be uniquely attributed to this account. An Admin must record an explicit ownership decision for each before permanent deletion can be considered.";
  const blockers: DeletionBlocker[] = [
    ...result.blockers,
    {
      key: "AMBIGUOUS_LEGACY_ATTRIBUTION",
      label: "Ambiguous legacy attribution",
      description,
      count: manualResolution.unresolvedCount,
    },
  ];
  return {
    ...result,
    canDelete: false,
    blockers,
    categories: blockers.map((b) => ({ key: b.key, label: b.label, classification: "blocker" as const })),
  };
}
