/**
 * Behavioral tests for the two context-aware, non-ambiguous refund payment
 * selection rules. Exercises the real, pure functions (not regex/source
 * assertions) against synthetic ballet_payments-shaped rows.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  selectActiveEnrollmentCyclePayment,
  selectPreActivationEligiblePayment,
  findPaidCycleActiveOn,
  resolveCurrentBalletCycle,
  isCashRefundEligible,
  type RefundEligibilityPaymentInput,
} from "./balletRefundEligibilityMath";

let nextId = 1;
function row(overrides: Partial<RefundEligibilityPaymentInput>): RefundEligibilityPaymentInput {
  const id = overrides.id ?? nextId++;
  return {
    id,
    amountEgp: 1000,
    status: "paid",
    paymentMethod: "inPerson",
    subscriptionStartDate: null,
    subscriptionExpiresAt: null,
    paidAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const EFFECTIVE = "2026-07-15";

// ─── A. Active enrollment cancellation ("Cancel Program") ──────────────────────

test("1. current cycle starts in the past and expires in the future → selected", () => {
  const current = row({ id: 1, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const result = selectActiveEnrollmentCyclePayment([current], EFFECTIVE);
  assert.deepEqual(result, { kind: "eligible", payment: current });
});

test("2. future renewal starting next month is not selected today", () => {
  const futureRenewal = row({ id: 1, subscriptionStartDate: "2026-08-01", subscriptionExpiresAt: "2026-08-31" });
  const result = selectActiveEnrollmentCyclePayment([futureRenewal], EFFECTIVE);
  assert.deepEqual(result, { kind: "noCurrentCycle" });
});

test("3. current cycle and a future renewal both exist → current cycle is selected, not the renewal", () => {
  const current = row({ id: 1, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const futureRenewal = row({ id: 2, subscriptionStartDate: "2026-08-01", subscriptionExpiresAt: "2026-08-31" });
  const result = selectActiveEnrollmentCyclePayment([current, futureRenewal], EFFECTIVE);
  assert.equal(result.kind, "eligible");
  assert.equal((result as { kind: "eligible"; payment: RefundEligibilityPaymentInput }).payment.id, 1);
});

test("4. current cycle paid by a non-inPerson method plus an older cash payment → no automatic cash refund; the older payment is never selected", () => {
  const currentKashier = row({ id: 1, paymentMethod: "kashier", subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const olderCash = row({ id: 2, paymentMethod: "inPerson", subscriptionStartDate: "2026-05-01", subscriptionExpiresAt: "2026-05-31" });
  const result = selectActiveEnrollmentCyclePayment([currentKashier, olderCash], EFFECTIVE);
  assert.equal(result.kind, "currentCycleNotCash");
  assert.equal((result as { kind: "currentCycleNotCash"; payment: RefundEligibilityPaymentInput }).payment.id, 1);
});

test("6. only expired subscription cycles exist during an active cancellation → not eligible (no fallback to an expired cycle)", () => {
  const expiredOne = row({ id: 1, subscriptionStartDate: "2026-04-01", subscriptionExpiresAt: "2026-04-30" });
  const expiredTwo = row({ id: 2, subscriptionStartDate: "2026-05-01", subscriptionExpiresAt: "2026-05-31" });
  const result = selectActiveEnrollmentCyclePayment([expiredOne, expiredTwo], EFFECTIVE);
  assert.deepEqual(result, { kind: "noCurrentCycle" });
});

test("11. boundary — subscriptionStartDate equals the effective date → eligible (inclusive)", () => {
  const startsToday = row({ id: 1, subscriptionStartDate: EFFECTIVE, subscriptionExpiresAt: "2026-08-14" });
  const result = selectActiveEnrollmentCyclePayment([startsToday], EFFECTIVE);
  assert.equal(result.kind, "eligible");
});

test("12. boundary — subscriptionExpiresAt equals the effective date → eligible (inclusive)", () => {
  const expiresToday = row({ id: 1, subscriptionStartDate: "2026-06-15", subscriptionExpiresAt: EFFECTIVE });
  const result = selectActiveEnrollmentCyclePayment([expiresToday], EFFECTIVE);
  assert.equal(result.kind, "eligible");
});

test("no candidates at all → noCurrentCycle", () => {
  assert.deepEqual(selectActiveEnrollmentCyclePayment([], EFFECTIVE), { kind: "noCurrentCycle" });
});

test("a non-paid renewal within the effective window is never selected (only status='paid' counts)", () => {
  const pendingCurrent = row({ id: 1, status: "pending", subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  assert.deepEqual(selectActiveEnrollmentCyclePayment([pendingCurrent], EFFECTIVE), { kind: "noCurrentCycle" });
});

test("current-cycle candidate with zero amount or missing paidAt is reported as currentCycleNotCash, never silently eligible", () => {
  const zeroAmount = row({ id: 1, amountEgp: 0, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const result = selectActiveEnrollmentCyclePayment([zeroAmount], EFFECTIVE);
  assert.equal(result.kind, "currentCycleNotCash");
});

test("overlapping current-cycle candidates: the EARLIEST-starting (already-active) cycle wins, per the documented boundary rule — never 'latest start wins'", () => {
  const earlier = row({ id: 5, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const later = row({ id: 6, subscriptionStartDate: "2026-07-10", subscriptionExpiresAt: "2026-08-09" });
  const result = selectActiveEnrollmentCyclePayment([earlier, later], EFFECTIVE);
  assert.equal(result.kind, "eligible");
  assert.equal((result as { kind: "eligible"; payment: RefundEligibilityPaymentInput }).payment.id, 5);
});

// ─── B. Pre-activation application cancellation ("Cancel Application") ─────────

test("7. pre-activation flat paid inPerson payment (no subscription cycle) → eligible", () => {
  const flatFee = row({ id: 1, subscriptionStartDate: null, subscriptionExpiresAt: null });
  assert.equal(selectPreActivationEligiblePayment([flatFee])?.id, 1);
});

test("8. pre-activation flow does not select an expired subscription cycle, even if it's the only paid inPerson row", () => {
  const expiredCycle = row({ id: 1, subscriptionStartDate: "2026-01-01", subscriptionExpiresAt: "2026-01-31" });
  assert.equal(selectPreActivationEligiblePayment([expiredCycle]), null);
});

test("pre-activation flow does not select an active or future subscription cycle either", () => {
  const activeCycle = row({ id: 1, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const futureCycle = row({ id: 2, subscriptionStartDate: "2026-08-01", subscriptionExpiresAt: "2026-08-31" });
  assert.equal(selectPreActivationEligiblePayment([activeCycle, futureCycle]), null);
});

test("pre-activation: among multiple flat payments, the most recently paid one wins", () => {
  const older = row({ id: 1, paidAt: "2026-01-01T00:00:00.000Z" });
  const newer = row({ id: 2, paidAt: "2026-06-01T00:00:00.000Z" });
  assert.equal(selectPreActivationEligiblePayment([older, newer])?.id, 2);
});

test("pre-activation: non-inPerson flat payments are never selected", () => {
  const kashierFlat = row({ id: 1, paymentMethod: "kashier" });
  assert.equal(selectPreActivationEligiblePayment([kashierFlat]), null);
});

test("no candidates at all → null (pre-activation)", () => {
  assert.equal(selectPreActivationEligiblePayment([]), null);
});

// ─── C. findPaidCycleActiveOn — the shared effective-date derivation primitive ──
//
// This is the exact function balletRefundEligibility.ts's currentCycleExpiryOn()
// wraps for the Parent End of Current Period effective-date fix. It must never
// let a future renewal or an expired cycle define "today's" active cycle —
// unlike balletSubscriptions.ts's currentSubscription(), which has no concept
// of "today" at all and would return a paid future renewal in scenario 1.

test("1. current cycle + future renewal: the current cycle's expiry is used, the future renewal is ignored", () => {
  const current = row({ id: 1, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const futureRenewal = row({ id: 2, subscriptionStartDate: "2026-08-01", subscriptionExpiresAt: "2026-08-31" });
  const result = findPaidCycleActiveOn([current, futureRenewal], EFFECTIVE);
  assert.equal(result?.id, 1);
  assert.equal(result?.subscriptionExpiresAt, "2026-07-31");
});

test("2. only a future renewal exists: it does not define today's effective date", () => {
  const futureRenewal = row({ id: 1, subscriptionStartDate: "2026-08-01", subscriptionExpiresAt: "2026-08-31" });
  assert.equal(findPaidCycleActiveOn([futureRenewal], EFFECTIVE), null);
});

test("3. only an expired cycle exists: it does not define today's effective date", () => {
  const expired = row({ id: 1, subscriptionStartDate: "2026-05-01", subscriptionExpiresAt: "2026-05-31" });
  assert.equal(findPaidCycleActiveOn([expired], EFFECTIVE), null);
});

test("4. current cycle begins exactly today: its expiry is used (inclusive start boundary)", () => {
  const startsToday = row({ id: 1, subscriptionStartDate: EFFECTIVE, subscriptionExpiresAt: "2026-08-14" });
  const result = findPaidCycleActiveOn([startsToday], EFFECTIVE);
  assert.equal(result?.subscriptionExpiresAt, "2026-08-14");
});

test("5. current cycle expires exactly today: today is a valid effective date (inclusive expiry boundary)", () => {
  const expiresToday = row({ id: 1, subscriptionStartDate: "2026-06-15", subscriptionExpiresAt: EFFECTIVE });
  const result = findPaidCycleActiveOn([expiresToday], EFFECTIVE);
  assert.equal(result?.subscriptionExpiresAt, EFFECTIVE);
});

test("findPaidCycleActiveOn never returns a pending (unpaid) renewal even within the date window", () => {
  const pendingCurrent = row({ id: 1, status: "pending", subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  assert.equal(findPaidCycleActiveOn([pendingCurrent], EFFECTIVE), null);
});

test("findPaidCycleActiveOn is method-agnostic — a non-inPerson current cycle still defines the effective date", () => {
  const currentKashier = row({ id: 1, paymentMethod: "kashier", subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const result = findPaidCycleActiveOn([currentKashier], EFFECTIVE);
  assert.equal(result?.id, 1, "effective-date derivation must not depend on payment method — only the refund-eligibility check downstream does");
});

// ─── D. resolveCurrentBalletCycle — the single shared current-cycle resolver ───
//
// The canonical resolver used ONCE per decision by both Parent and Admin
// End-of-Period cancellation paths, so effective-date derivation and refund
// eligibility can never independently drift onto different payments.

test("1. current cycle plus future renewal → the exact current payment identity is returned, never the renewal", () => {
  const current = row({ id: 1, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const futureRenewal = row({ id: 2, subscriptionStartDate: "2026-08-01", subscriptionExpiresAt: "2026-08-31" });
  const resolved = resolveCurrentBalletCycle([current, futureRenewal], EFFECTIVE);
  assert.equal(resolved?.paymentId, 1);
  assert.equal(resolved?.subscriptionExpiresAt, "2026-07-31");
});

test("2. current cycle's expiry equals the renewal's start date → the documented boundary rule applies: the already-active cycle (earlier start) wins, not the renewal", () => {
  const current = row({ id: 1, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const renewalStartingOnExpiry = row({ id: 2, subscriptionStartDate: "2026-07-31", subscriptionExpiresAt: "2026-08-30" });
  const resolved = resolveCurrentBalletCycle([current, renewalStartingOnExpiry], "2026-07-31");
  assert.equal(resolved?.paymentId, 1, "the cycle already active before the boundary date owns that date through its own expiry");
});

test("3. request one day before the boundary → the current cycle is selected", () => {
  const current = row({ id: 1, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const renewalStartingOnExpiry = row({ id: 2, subscriptionStartDate: "2026-07-31", subscriptionExpiresAt: "2026-08-30" });
  const resolved = resolveCurrentBalletCycle([current, renewalStartingOnExpiry], "2026-07-30");
  assert.equal(resolved?.paymentId, 1);
});

test("4. request exactly on the boundary date → the documented cycle (earlier-starting, already-active one) is selected deterministically", () => {
  const current = row({ id: 1, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const renewalStartingOnExpiry = row({ id: 2, subscriptionStartDate: "2026-07-31", subscriptionExpiresAt: "2026-08-30" });
  const resolved = resolveCurrentBalletCycle([current, renewalStartingOnExpiry], "2026-07-31");
  assert.equal(resolved?.paymentId, 1);
  // The day after the boundary, the renewal is unambiguously current on its own.
  const resolvedNextDay = resolveCurrentBalletCycle([current, renewalStartingOnExpiry], "2026-08-01");
  assert.equal(resolvedNextDay?.paymentId, 2);
});

test("5. no active cycle exists → resolver returns null, so no refund payment is ever selected", () => {
  const expired = row({ id: 1, subscriptionStartDate: "2026-01-01", subscriptionExpiresAt: "2026-01-31" });
  const future = row({ id: 2, subscriptionStartDate: "2026-12-01", subscriptionExpiresAt: "2026-12-31" });
  assert.equal(resolveCurrentBalletCycle([expired, future], EFFECTIVE), null);
});

test("6. current non-cash cycle → the same payment identity is resolved, but isCashRefundEligible() reports it ineligible", () => {
  const currentKashier = row({ id: 1, paymentMethod: "kashier", subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const resolved = resolveCurrentBalletCycle([currentKashier], EFFECTIVE);
  assert.equal(resolved?.paymentId, 1, "the resolver itself is method-agnostic — same identity regardless of method");
  assert.equal(isCashRefundEligible(resolved!), false, "but the SAME resolved identity is correctly reported as cash-ineligible");
});

test("6b. current cash cycle → same resolved identity, and isCashRefundEligible() reports it eligible", () => {
  const currentCash = row({ id: 1, paymentMethod: "inPerson", subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const resolved = resolveCurrentBalletCycle([currentCash], EFFECTIVE);
  assert.equal(resolved?.paymentId, 1);
  assert.equal(isCashRefundEligible(resolved!), true);
});

test("7. resolver identifies the current cycle regardless of whether it has already been fully refunded — remaining-balance is a separate, later DB-level check, not part of identity resolution, so there is no fallback to a different cycle here", () => {
  // resolveCurrentBalletCycle only knows about ballet_payments fields, not the
  // ballet_refunds ledger — "already fully refunded" is checked downstream
  // (refundableRemainingEgp) against the SAME resolved paymentId, never by
  // re-resolving a different cycle. This test documents that the resolver's
  // identity is stable and independent of refund-ledger state.
  const current = row({ id: 1, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const olderExpired = row({ id: 2, subscriptionStartDate: "2026-05-01", subscriptionExpiresAt: "2026-05-31" });
  const resolved = resolveCurrentBalletCycle([current, olderExpired], EFFECTIVE);
  assert.equal(resolved?.paymentId, 1, "identity resolution never falls back to an older cycle regardless of the current cycle's refund-ledger state");
});

test("8. genuine duplicate/overlapping cycles with the IDENTICAL start date → deterministic result (highest id wins), never an ambiguous/unresolved answer", () => {
  const duplicateA = row({ id: 10, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-07-31" });
  const duplicateB = row({ id: 11, subscriptionStartDate: "2026-07-01", subscriptionExpiresAt: "2026-08-15" });
  const resolved = resolveCurrentBalletCycle([duplicateA, duplicateB], EFFECTIVE);
  assert.equal(resolved?.paymentId, 11, "identical start dates are broken deterministically by highest id — never a random/unresolved choice");
});
