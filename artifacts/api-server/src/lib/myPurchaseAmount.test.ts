/**
 * F-04/F-19/F-05 regression coverage.
 *
 * Proves the /my/bookings and /my/packages customer-visible amount
 * policies: exact captured Finance amount wins over today's live
 * schedule/catalogue price, a non-monetary booking never fabricates a
 * cash figure, and a legacy record with no exact evidence keeps the
 * existing safe fallback.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { resolveMyBookingPriceEgp, resolveMyPackagePriceEgp } from "./myPurchaseAmount";

test("an exact captured amount wins, even when the live schedule price has since changed", () => {
  const price = resolveMyBookingPriceEgp({
    paymentRecordAmountAvailability: "exact",
    paymentRecordFinalPayableAmountMinor: 35000, // EGP 350 at booking time
    paymentStatus: "paid",
    schedulePriceEgp: 500, // the class was re-priced to EGP 500 since
  });
  assert.equal(price, 350, "the historical captured amount must be shown, not today's schedule price");
});

test("a valid historical amount never becomes 0 because the live schedule price is now null", () => {
  const price = resolveMyBookingPriceEgp({
    paymentRecordAmountAvailability: "exact",
    paymentRecordFinalPayableAmountMinor: 30000,
    paymentStatus: "pending_payment",
    schedulePriceEgp: null, // schedule since deleted/unpriced
  });
  assert.equal(price, 300, "an exact captured amount must not be discarded just because the schedule price is absent");
});

test("a package-credit booking (not_required) shows 0 and never fabricates a cash payment", () => {
  const price = resolveMyBookingPriceEgp({
    paymentRecordAmountAvailability: null,
    paymentRecordFinalPayableAmountMinor: null,
    paymentStatus: "not_required",
    schedulePriceEgp: 400, // the class's walk-in price — irrelevant here
  });
  assert.equal(price, 0, "package-credit bookings never had a payment_records row and must never show a cash figure");
});

test("a free booking (not_required) shows 0 even if a schedule price is somehow present", () => {
  const price = resolveMyBookingPriceEgp({
    paymentRecordAmountAvailability: null,
    paymentRecordFinalPayableAmountMinor: null,
    paymentStatus: "not_required",
    schedulePriceEgp: 300,
  });
  assert.equal(price, 0);
});

test("a legacy direct-payment booking with no payment_records row follows the existing safe schedule-price fallback", () => {
  const price = resolveMyBookingPriceEgp({
    paymentRecordAmountAvailability: null,
    paymentRecordFinalPayableAmountMinor: null,
    paymentStatus: "paid",
    schedulePriceEgp: 350,
  });
  assert.equal(price, 350, "a genuinely legacy monetary booking with no exact evidence keeps today's existing fallback, unchanged");
});

test("a legacy direct-payment booking with no evidence AND no schedule price falls back to 0 — the existing behavior, not a new invention", () => {
  const price = resolveMyBookingPriceEgp({
    paymentRecordAmountAvailability: null,
    paymentRecordFinalPayableAmountMinor: null,
    paymentStatus: "pending_payment",
    schedulePriceEgp: null,
  });
  assert.equal(price, 0);
});

test("amountAvailability other than exact (estimated_backfill / unknown) is never trusted as the exact amount", () => {
  for (const availability of ["estimated_backfill", "unknown"]) {
    const price = resolveMyBookingPriceEgp({
      paymentRecordAmountAvailability: availability,
      paymentRecordFinalPayableAmountMinor: 99999, // present, but must not be trusted at this availability tier
      paymentStatus: "paid",
      schedulePriceEgp: 300,
    });
    assert.equal(
      price,
      300,
      `amountAvailability "${availability}" must fall through to the legacy fallback, not the untrusted captured figure`,
    );
  }
});

test("amountAvailability exact but a null captured amount is never trusted (defensive guard)", () => {
  const price = resolveMyBookingPriceEgp({
    paymentRecordAmountAvailability: "exact",
    paymentRecordFinalPayableAmountMinor: null,
    paymentStatus: "paid",
    schedulePriceEgp: 300,
  });
  assert.equal(price, 300, "a null captured amount must never be coerced into 0 or trusted — fall through to the legacy fallback");
});

test("a refunded booking with an exact captured amount still shows the original historical amount", () => {
  const price = resolveMyBookingPriceEgp({
    paymentRecordAmountAvailability: "exact",
    paymentRecordFinalPayableAmountMinor: 30000,
    paymentStatus: "refunded",
    schedulePriceEgp: 999,
  });
  assert.equal(price, 300, "refund status does not erase what was historically charged");
});

// ─── /my/packages — F-05 ────────────────────────────────────────────────────

test("a discounted purchase shows the discounted historical amount, not the undiscounted catalogue price", () => {
  const price = resolveMyPackagePriceEgp({
    paymentRecordAmountAvailability: "exact",
    paymentRecordFinalPayableAmountMinor: 170000, // EGP 1700 — gross 2000 minus a 300 discount, already netted
    catalogPriceEgp: 2000,
  });
  assert.equal(price, 1700, "the captured (already-discounted) amount must win over the undiscounted catalogue price");
});

test("a catalogue price change after purchase does not alter the historical display", () => {
  const price = resolveMyPackagePriceEgp({
    paymentRecordAmountAvailability: "exact",
    paymentRecordFinalPayableAmountMinor: 200000, // EGP 2000 at purchase time
    catalogPriceEgp: 2400, // admin has since raised the catalogue price
  });
  assert.equal(price, 2000, "the historical captured amount must be shown regardless of a later catalogue price edit");
});

test("a normal undiscounted purchase with a captured amount remains correct", () => {
  const price = resolveMyPackagePriceEgp({
    paymentRecordAmountAvailability: "exact",
    paymentRecordFinalPayableAmountMinor: 200000,
    catalogPriceEgp: 2000,
  });
  assert.equal(price, 2000);
});

test("a legacy order with no payment_records row keeps today's existing catalogue-price fallback, unchanged", () => {
  const price = resolveMyPackagePriceEgp({
    paymentRecordAmountAvailability: null,
    paymentRecordFinalPayableAmountMinor: null,
    catalogPriceEgp: 1800,
  });
  assert.equal(price, 1800, "a legacy order with no exact evidence keeps the pre-existing catalogue-price display, unchanged");
});

test("a legacy order with neither exact evidence nor a resolvable catalogue price returns null, never a fabricated figure", () => {
  const price = resolveMyPackagePriceEgp({
    paymentRecordAmountAvailability: null,
    paymentRecordFinalPayableAmountMinor: null,
    catalogPriceEgp: null,
  });
  assert.equal(price, null, "genuinely unknown legacy pricing must surface as null, exactly as it already did before this correction");
});

test("amountAvailability other than exact is never trusted for a package order either", () => {
  for (const availability of ["estimated_backfill", "unknown"]) {
    const price = resolveMyPackagePriceEgp({
      paymentRecordAmountAvailability: availability,
      paymentRecordFinalPayableAmountMinor: 999999,
      catalogPriceEgp: 2000,
    });
    assert.equal(price, 2000, `amountAvailability "${availability}" must fall through to the catalogue fallback, not the untrusted figure`);
  }
});

test("amountAvailability exact but a null captured amount falls through to the catalogue fallback (defensive guard)", () => {
  const price = resolveMyPackagePriceEgp({
    paymentRecordAmountAvailability: "exact",
    paymentRecordFinalPayableAmountMinor: null,
    catalogPriceEgp: 2000,
  });
  assert.equal(price, 2000);
});
