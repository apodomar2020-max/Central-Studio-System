/**
 * Ballet refund-eligibility helpers.
 *
 * Extracted so both the cancellation/refund routes and the admin application
 * detail route can compute the same "is there a refundable inPerson payment,
 * and how much is left" answer without duplicating the SQL. Refunds remain
 * cash-only against a paid inPerson payment (see migration 0068 + spec §8).
 *
 * Payment selection is context-aware — an active-enrollment cancellation
 * ("Cancel Program") and a pre-activation cancellation ("Cancel Application")
 * use two different, non-ambiguous rules, never one shared fallback.
 *
 * Current-cycle IDENTITY is resolved exactly ONCE per decision via
 * resolveApplicationCurrentCycle() (the DB wrapper around
 * balletRefundEligibilityMath.ts's resolveCurrentBalletCycle()) — callers that
 * need the SAME identity for more than one purpose (effective-date derivation
 * AND refund eligibility, e.g. balletCancellationRefunds.ts's Parent/Admin
 * End-of-Period paths) must resolve once and reuse the result, never call
 * this twice with different reference dates for what should be one decision.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { db, balletPaymentsTable, balletRefundsTable } from "@workspace/db";
import {
  selectPreActivationEligiblePayment,
  resolveCurrentBalletCycle,
  isCashRefundEligible,
  todayDateOnly,
  type ResolvedCurrentBalletCycle,
} from "./balletRefundEligibilityMath";

export { selectPreActivationEligiblePayment, resolveCurrentBalletCycle, isCashRefundEligible, todayDateOnly };
export type { ResolvedCurrentBalletCycle };

/** Refund rows in these statuses hold/consume refundable balance on a payment. */
export const BALLET_CONSUMING_REFUND_STATUSES = ["approved", "processing", "refunded"] as const;

export type BalletPaymentRow = typeof balletPaymentsTable.$inferSelect;

/**
 * Which cancellation flow refund eligibility is being evaluated for.
 *
 * The active-enrollment case carries an ALREADY-RESOLVED cycle identity
 * (from resolveApplicationCurrentCycle()), not a bare date — this is what
 * guarantees the same paymentId used to derive an effective date is also the
 * one refund eligibility is judged against, with no second, independently-run
 * lookup that could resolve a different payment.
 */
export type BalletRefundEligibilityContext =
  | { kind: "activeEnrollment"; resolvedCycle: ResolvedCurrentBalletCycle | null }
  | { kind: "preActivation" };

async function loadPaidPaymentsForApplication(applicationId: number, client: typeof db): Promise<BalletPaymentRow[]> {
  return client
    .select()
    .from(balletPaymentsTable)
    .where(and(
      eq(balletPaymentsTable.applicationId, applicationId),
      eq(balletPaymentsTable.status, "paid"),
    ));
}

/**
 * Resolves the current paid subscription cycle for an application against
 * `referenceDate` — the ONE canonical current-cycle lookup used by both
 * Parent and Admin End-of-Period cancellation paths. Callers needing the
 * identity for multiple purposes (effective date + refund eligibility) must
 * call this ONCE and reuse the returned object, never re-derive it.
 */
export async function resolveApplicationCurrentCycle(
  applicationId: number,
  referenceDate: string,
  client: typeof db = db,
): Promise<ResolvedCurrentBalletCycle | null> {
  const rows = await loadPaidPaymentsForApplication(applicationId, client);
  return resolveCurrentBalletCycle(rows, referenceDate);
}

/** Pre-activation selection against the real DB — see selectPreActivationEligiblePayment(). */
export async function preActivationEligiblePayment(
  applicationId: number,
  client: typeof db = db,
): Promise<BalletPaymentRow | null> {
  const rows = await loadPaidPaymentsForApplication(applicationId, client);
  return selectPreActivationEligiblePayment(rows);
}

/** The subset of an eligible payment's fields callers of eligiblePaymentForContext actually need. */
export interface EligiblePaymentIdentity {
  id: number;
  amountEgp: number;
  paymentMethod: string | null;
}

/**
 * Resolves the single eligible-for-cash-refund payment (if any) for the given
 * context. Returns null both when there is no matching payment at all AND
 * when an active enrollment's current cycle exists but isn't inPerson — in
 * neither case does this fall back to a different payment.
 *
 * For `activeEnrollment`, this performs NO additional DB lookup — it only
 * judges cash-eligibility of the cycle identity the caller already resolved
 * via resolveApplicationCurrentCycle(). For `preActivation`, a separate,
 * unrelated selection (no "current cycle" concept applies) still queries and
 * selects independently, since there is no shared identity to reuse there.
 */
export async function eligiblePaymentForContext(
  applicationId: number,
  context: BalletRefundEligibilityContext,
  client: typeof db = db,
): Promise<EligiblePaymentIdentity | null> {
  if (context.kind === "preActivation") {
    const payment = await preActivationEligiblePayment(applicationId, client);
    return payment ? { id: payment.id, amountEgp: payment.amountEgp, paymentMethod: payment.paymentMethod } : null;
  }
  if (!context.resolvedCycle || !isCashRefundEligible(context.resolvedCycle)) return null;
  return {
    id: context.resolvedCycle.paymentId,
    amountEgp: context.resolvedCycle.amountEgp,
    paymentMethod: context.resolvedCycle.paymentMethod,
  };
}

/**
 * Remaining refundable EGP on a payment = original amount minus the sum of
 * already-committed refund amounts (approved/processing/refunded). An optional
 * refund id can be excluded so a row can re-validate its own approved amount.
 */
export async function refundableRemainingEgp(
  paymentId: number,
  originalAmountEgp: number,
  client: typeof db = db,
  excludeRefundId?: number,
): Promise<number> {
  const conditions = [eq(balletRefundsTable.paymentId, paymentId)];
  if (excludeRefundId != null) conditions.push(ne(balletRefundsTable.id, excludeRefundId));
  const [{ total }] = await client
    .select({
      total: sql<number>`
        coalesce(sum(coalesce(${balletRefundsTable.refundedAmountEgp}, ${balletRefundsTable.approvedAmountEgp}, 0)) filter (
          where ${balletRefundsTable.status} in ('approved','processing','refunded')
        ), 0)::int
      `,
    })
    .from(balletRefundsTable)
    .where(and(...conditions));
  return originalAmountEgp - Number(total ?? 0);
}

/**
 * Refund-eligibility summary for an application: the eligible payment (if
 * any) under the given context, its original amount, the amount already
 * committed to refunds, and how much is still refundable. Returns
 * { eligible: false } when there is no eligible payment (none found, the
 * active enrollment's current cycle isn't inPerson, or the eligible payment
 * already has zero remaining balance). Used by the admin Danger Zone so the
 * admin can see the payment before requesting a cash refund — the parent
 * never sees or enters an amount.
 */
export async function balletRefundEligibilitySummary(
  applicationId: number,
  context: BalletRefundEligibilityContext,
  client: typeof db = db,
): Promise<{
  eligible: boolean;
  paymentId: number | null;
  paymentMethod: string | null;
  originalAmountEgp: number | null;
  alreadyRefundedEgp: number;
  remainingRefundableEgp: number;
}> {
  const payment = await eligiblePaymentForContext(applicationId, context, client);
  if (!payment) {
    return {
      eligible: false,
      paymentId: null,
      paymentMethod: null,
      originalAmountEgp: null,
      alreadyRefundedEgp: 0,
      remainingRefundableEgp: 0,
    };
  }
  const remaining = await refundableRemainingEgp(payment.id, payment.amountEgp, client);
  return {
    eligible: remaining > 0,
    paymentId: payment.id,
    paymentMethod: payment.paymentMethod,
    originalAmountEgp: payment.amountEgp,
    alreadyRefundedEgp: payment.amountEgp - remaining,
    remainingRefundableEgp: Math.max(remaining, 0),
  };
}
