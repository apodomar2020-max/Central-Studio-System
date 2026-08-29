/**
 * Regression coverage for class-booking promo codes.
 *
 * The request-contract checks are executable without Postgres. The source
 * assertions pin the transaction boundary because the repository's route
 * integration harness requires a live DATABASE_URL.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { CreateBookingBody } from "@workspace/api-zod";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const bookingsRoute = read("artifacts/api-server/src/routes/bookings.ts");
const promotionsRoute = read("artifacts/api-server/src/routes/promotions.ts");
const validatePromotionEndpoint = promotionsRoute.slice(
  promotionsRoute.indexOf('router.post("/promotions/validate"'),
);
const promotionService = read("artifacts/api-server/src/lib/promotionService.ts");
const bookingFlow = read("artifacts/central/app/booking/flow.tsx");

test("CreateBookingBody accepts the existing Promotions code and the reviewed final total", () => {
  const parsed = CreateBookingBody.safeParse({
    studentName: "Nour Hassan",
    studentEmail: "nour@example.com",
    classId: 5,
    scheduleId: 9,
    paymentMode: "pay_at_studio",
    expectedPriceEgp: 420,
    promoCode: "WELCOME10",
    expectedFinalPriceEgp: 378,
  });
  assert.equal(parsed.success, true);
});

test("student promotion validation resolves class price and branch on the server", () => {
  assert.match(promotionsRoute, /resolveClassPromotionContext\(req\.studentId!, parsed\.data\.scheduleId!\)/);
  assert.match(promotionService, /resolveSingleClassPriceEgp\(db, \{/);
  assert.match(promotionService, /branch:\s*schedule\.location/);
});

test("promotion validation accepts one optional package or schedule context without coercing a missing packageId to NaN", () => {
  assert.match(promotionsRoute, /packageId:\s*z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
  assert.match(promotionsRoute, /scheduleId:\s*z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
  assert.match(validatePromotionEndpoint, /code:\s*"invalid_promotion_context"/);
  assert.doesNotMatch(validatePromotionEndpoint, /res\.status\(400\)\.json\(\{ error: parsed\.error\.message \}\)/);
});

test("booking creation revalidates and locks promotion usage before inserting a booking", () => {
  const validateIndex = bookingsRoute.indexOf("lockRedemptionScope: true");
  const bookingInsertIndex = bookingsRoute.indexOf(".insert(bookingsTable)\n      .values({");
  assert.ok(validateIndex > 0, "promo validation must lock its redemption scope");
  assert.ok(bookingInsertIndex > validateIndex, "promo validation must happen before the booking insert");
  assert.match(bookingsRoute, /egpToMinor\(expectedFinalPriceEgp\)\s*!==\s*egpToMinor\(promotionEvaluation\.finalSubtotal\)/);
});

test("promotion redemption is linked to the new booking inside the booking transaction", () => {
  const transactionStart = bookingsRoute.indexOf("db.transaction(async (tx)");
  const redemptionIndex = bookingsRoute.indexOf("await createPromotionRedemptions(tx, promotionEvaluation");
  const transactionEnd = bookingsRoute.indexOf("return { kind: \"created\" as const, inserted }", redemptionIndex);
  assert.ok(transactionStart > 0 && redemptionIndex > transactionStart && transactionEnd > redemptionIndex);
  assert.match(bookingsRoute.slice(redemptionIndex, transactionEnd), /bookingId:\s*inserted\.id/);
});

test("package-credit checkout excludes promo code and tax/discount rows while cash keeps tax at zero", () => {
  assert.match(bookingFlow, /\{!isPackageMode \? \(/);
  assert.match(bookingFlow, /<Text style=\{styles\.priceLabel\}>Tax<\/Text><Text style=\{styles\.priceValue\}>0 EGP<\/Text>/);
  assert.match(bookingFlow, /promoCode:\s*apiPaymentMode === "pay_at_studio"/);
});
