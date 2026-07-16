/**
 * Pure payment-selection math for Ballet refund eligibility and current-cycle
 * identity resolution.
 *
 * Intentionally does NOT import @workspace/db (unlike balletRefundEligibility.ts,
 * which wraps this with the actual DB query) so it can be unit-tested without a
 * database connection/pool — mirrors the existing financialAggregateMath.ts /
 * financialAggregates.ts split in this same directory.
 *
 * The canonical primitive is resolveCurrentBalletCycle() — resolve the current
 * paid subscription cycle EXACTLY ONCE per decision, and reuse that single
 * resolved identity (paymentId + dates) for every downstream purpose
 * (effective-date derivation, refund-eligibility check, audit/storage). Two
 * independent lookups for "what's the current cycle" — even if each is
 * individually correct — can drift apart if one caller's inputs differ even
 * slightly from another's; resolving once and threading the SAME object
 * through eliminates that risk entirely.
 *
 * Two separate, non-ambiguous SELECTION rules on top of that resolution —
 * never one shared fallback:
 *
 *   - selectActiveEnrollmentCyclePayment() for "Cancel Program" (an active
 *     enrollment). Resolves the current cycle via resolveCurrentBalletCycle(),
 *     THEN checks whether that specific payment is inPerson. Never
 *     substitutes an older inPerson payment when the true current cycle uses
 *     another method, and never falls back to an expired cycle or a
 *     not-yet-started renewal.
 *
 *   - selectPreActivationEligiblePayment() for "Cancel Application" (no
 *     enrollment yet). Only ever considers flat, cycle-less paid inPerson
 *     payments (e.g. an assessment/registration fee) — a subscription-cycle
 *     payment (active, future, or expired) is never substituted for one.
 *
 * Both dates ("YYYY-MM-DD") are plain business calendar days compared as
 * strings — ISO 8601 date-only strings sort lexicographically identical to
 * chronological order, so `a <= b` is a correct and timezone-safe date
 * comparison here (matches the "YYYY-MM-DD" convention already used
 * throughout balletSubscriptions.ts).
 *
 * ─── Boundary rule (documented, explicit — not an implicit tie-break) ───────
 *
 * Subscription windows are inclusive on both ends. If cycle A's expiry and
 * cycle B's (a renewal's) start fall on the exact same date X, both windows
 * contain X, so a plain "does referenceDate fall in this window" filter
 * matches both. The rule this codebase uses to resolve that overlap:
 *
 *   THE CYCLE ALREADY ACTIVE BEFORE X REMAINS THE CANCELLATION CYCLE THROUGH
 *   AND INCLUDING X. A renewal only takes ownership of dates strictly AFTER
 *   its own start date when another cycle's own window also reaches that far.
 *
 * Concretely: among all candidates whose window contains referenceDate, the
 * one with the EARLIEST subscriptionStartDate wins (never "latest start
 * wins" — that would hand the shared boundary day to the renewal instead).
 * Ties on identical start dates (genuine duplicate/overlapping data, not
 * expected in normal operation) are broken by highest id, for a fully
 * deterministic result in every case — this never returns an ambiguous or
 * unresolved answer for two candidates with a real window overlap.
 *
 * This mirrors the app's existing "not expired while daysRemaining >= 0"
 * convention (balletSubscriptions.ts's serializePaymentCycle: a cycle is
 * still considered covering its own expiry date, not already succeeded by
 * whatever comes next) — i.e. a subscription "through July 31" genuinely
 * covers July 31; a renewal "from July 31" only takes over starting Aug 1
 * unless no earlier-starting cycle also reaches July 31.
 */

/** The subset of a ballet_payments row these selection rules read. */
export interface RefundEligibilityPaymentInput {
  id: number;
  status: string;
  paymentMethod: string | null;
  paidAt: string | null;
  amountEgp: number;
  subscriptionStartDate: string | null;
  subscriptionExpiresAt: string | null;
}

function hasSubscriptionPeriod(row: RefundEligibilityPaymentInput): boolean {
  return row.subscriptionStartDate != null && row.subscriptionExpiresAt != null;
}

function isPaidCashCandidate(row: RefundEligibilityPaymentInput): boolean {
  return row.paymentMethod === "inPerson" && row.paidAt != null && row.amountEgp > 0;
}

export function todayDateOnly(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ─── Canonical current-cycle resolution (resolve once, reuse everywhere) ────────

/**
 * The resolved identity of the subscription cycle active on a given
 * reference date — carries everything downstream code needs (the exact
 * paymentId to link a refund/effective-date to, plus the fields needed to
 * separately judge cash-refund eligibility) so a single resolution can serve
 * every purpose without a second, independently-resolved lookup.
 *
 * paymentMethod/paidAt are nullable because ballet_payments.paymentMethod has
 * no DB-level NOT NULL constraint (legacy rows may predate that column being
 * populated) — this is deliberately more precise than a bare `string`, since
 * silently coercing a genuinely-unknown method to a fixed value would let an
 * unrelated legacy row look falsely cash-eligible or falsely ineligible.
 */
export interface ResolvedCurrentBalletCycle {
  paymentId: number;
  subscriptionStartDate: string;
  subscriptionExpiresAt: string;
  paymentMethod: string | null;
  status: string;
  paidAt: string | null;
  amountEgp: number;
}

/**
 * Resolves the SINGLE paid payment whose subscription window actually
 * contains `referenceDate` — i.e. the cycle genuinely active on that date,
 * never a not-yet-started renewal or an already-expired historical cycle.
 * This is the one and only place "which cycle is current" gets decided;
 * every other function in this module and every calling route must resolve
 * through this (directly or via findPaidCycleActiveOn) exactly once per
 * decision and reuse the result, never re-derive it independently.
 *
 * Requires: status='paid', a complete period (both dates present), and
 * subscriptionStartDate <= referenceDate <= subscriptionExpiresAt (both
 * inclusive). Returns null — never an unrelated historical payment — when no
 * candidate's window contains referenceDate.
 *
 * See the module-level boundary-rule doc above for the exact, deterministic
 * overlap rule used when more than one candidate's window contains the same
 * referenceDate.
 */
export function resolveCurrentBalletCycle<T extends RefundEligibilityPaymentInput>(
  candidates: T[],
  referenceDate: string,
): ResolvedCurrentBalletCycle | null {
  const withinWindow = candidates.filter((row) =>
    row.status === "paid"
    && hasSubscriptionPeriod(row)
    && row.subscriptionStartDate! <= referenceDate
    && row.subscriptionExpiresAt! >= referenceDate,
  );
  if (withinWindow.length === 0) return null;

  // Boundary rule: the EARLIEST-starting (already-active) cycle wins the
  // shared boundary day — never "latest start wins" (see module doc).
  const [current] = withinWindow.slice().sort((a, b) => {
    const byStart = a.subscriptionStartDate!.localeCompare(b.subscriptionStartDate!);
    if (byStart !== 0) return byStart;
    return b.id - a.id;
  });

  return {
    paymentId: current!.id,
    subscriptionStartDate: current!.subscriptionStartDate!,
    subscriptionExpiresAt: current!.subscriptionExpiresAt!,
    paymentMethod: current!.paymentMethod,
    status: current!.status,
    paidAt: current!.paidAt,
    amountEgp: current!.amountEgp,
  };
}

/** Cash-refund eligibility of an ALREADY-resolved cycle — no second lookup. */
export function isCashRefundEligible(cycle: ResolvedCurrentBalletCycle): boolean {
  return cycle.paymentMethod === "inPerson" && cycle.paidAt != null && cycle.amountEgp > 0;
}

/**
 * @deprecated Thin compatibility wrapper over resolveCurrentBalletCycle() for
 * callers that only need the underlying candidate row (not the trimmed
 * identity shape). Prefer resolveCurrentBalletCycle() directly in new code.
 */
export function findPaidCycleActiveOn<T extends RefundEligibilityPaymentInput>(
  candidates: T[],
  referenceDate: string,
): T | null {
  const resolved = resolveCurrentBalletCycle(candidates, referenceDate);
  if (!resolved) return null;
  return candidates.find((row) => row.id === resolved.paymentId) ?? null;
}

// ─── A. Active enrollment cancellation ("Cancel Program") ──────────────────────

/**
 * Distinguishes "no current cycle at all" from "a current cycle exists but
 * isn't inPerson" — callers must not collapse these into one bare null, since
 * the correct response differs only in messaging, never in falling back to
 * another payment.
 */
export type ActiveEnrollmentPaymentSelection<T> =
  | { kind: "eligible"; payment: T }
  | { kind: "currentCycleNotCash"; payment: T }
  | { kind: "noCurrentCycle" };

/**
 * Finds the payment representing the subscription cycle active on
 * `effectiveDate` (the date the cancellation actually takes effect — today
 * for an immediate cancellation, the stored/anticipated approved effective
 * date for an end-of-period one — never just "the request creation date"),
 * THEN checks whether that specific payment is inPerson.
 *
 * Resolution is method-agnostic first (via resolveCurrentBalletCycle), THEN
 * the method is checked. This is deliberate: it is what prevents skipping a
 * non-inPerson current cycle and silently refunding an older, unrelated
 * inPerson payment instead.
 *
 * Convenience one-shot wrapper for callers that only need a single date-based
 * lookup; route-level code needing the SAME resolution for both an
 * effective-date derivation AND a refund-eligibility check should call
 * resolveCurrentBalletCycle() once instead and reuse the result for both,
 * rather than calling this a second time (see balletCancellationRefunds.ts).
 */
export function selectActiveEnrollmentCyclePayment<T extends RefundEligibilityPaymentInput>(
  candidates: T[],
  effectiveDate: string,
): ActiveEnrollmentPaymentSelection<T> {
  const current = findPaidCycleActiveOn(candidates, effectiveDate);
  if (!current) return { kind: "noCurrentCycle" };
  if (!isPaidCashCandidate(current)) return { kind: "currentCycleNotCash", payment: current };
  return { kind: "eligible", payment: current };
}

// ─── B. Pre-activation application cancellation ("Cancel Application") ─────────

/**
 * Finds the latest paid, inPerson, cycle-less payment for a pre-activation
 * cancellation (e.g. an assessment/registration fee taken before any
 * subscription cycle exists). Any payment carrying a subscription period —
 * active, future, or expired — is excluded entirely; a pre-activation
 * cancellation must never substitute a subscription-cycle payment for an
 * application fee.
 */
export function selectPreActivationEligiblePayment<T extends RefundEligibilityPaymentInput>(
  candidates: T[],
): T | null {
  const eligible = candidates.filter((row) =>
    row.status === "paid" && !hasSubscriptionPeriod(row) && isPaidCashCandidate(row),
  );
  if (eligible.length === 0) return null;

  return eligible
    .slice()
    .sort((a, b) => {
      const byPaidAt = String(b.paidAt ?? "").localeCompare(String(a.paidAt ?? ""));
      if (byPaidAt !== 0) return byPaidAt;
      return b.id - a.id;
    })[0] ?? null;
}
