/**
 * Pre-merge gap closure — Fix 1 (booking flow price binding) and Fix 3
 * (legacy /attendance walk-in price binding).
 *
 * No live Postgres is available for these tests, so full request/response
 * route tests aren't possible here (see bookingOccurrenceIntegrity.route.test.ts
 * for that style, which requires DATABASE_URL). What CAN be verified without a
 * database:
 *   1. The request contract: expectedPriceEgp is optional/nullable, so an
 *      older client that omits it validates exactly as before.
 *   2. Structurally, following the repo's own convention for asserting UI/
 *      route guarantees when no DOM/HTTP test harness is available (see
 *      financeUi.test.ts, balletCancellationUi.test.ts): the guard is wired
 *      in the right place, in the right order, for both the canonical
 *      booking flow and the legacy walk-in endpoint.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { CreateBookingBody } from "@workspace/api-zod";
import { CheckInBodyExtended } from "@workspace/api-zod";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const bookingsRoute = read("artifacts/api-server/src/routes/bookings.ts");
const attendanceRoute = read("artifacts/api-server/src/routes/attendance.ts");
const adminGatewayRoute = read("artifacts/api-server/src/routes/adminAttendanceGateway.ts");
const checkInService = read("artifacts/api-server/src/lib/checkInService.ts");
const flowScreen = read("artifacts/central/app/booking/flow.tsx");
const bookingErrorMessages = read("artifacts/central/services/bookingErrorMessages.ts");

// ─── Request contract ───────────────────────────────────────────────────────

test("CreateBookingBody: expectedPriceEgp is optional and nullable — an older client that omits it still validates", () => {
  const withoutField = CreateBookingBody.safeParse({
    studentName: "Nour Hassan",
    studentEmail: "nour@example.com",
    classId: 5,
    scheduleId: 9,
    paymentMode: "pay_at_studio",
  });
  assert.equal(withoutField.success, true);

  const withNumber = CreateBookingBody.safeParse({
    studentName: "Nour Hassan",
    studentEmail: "nour@example.com",
    expectedPriceEgp: 250,
  });
  assert.equal(withNumber.success, true);

  const withNull = CreateBookingBody.safeParse({
    studentName: "Nour Hassan",
    studentEmail: "nour@example.com",
    expectedPriceEgp: null,
  });
  assert.equal(withNull.success, true);
});

test("CheckInBodyExtended: expectedPriceEgp is optional and nullable — every known existing caller keeps validating", () => {
  const withoutField = CheckInBodyExtended.safeParse({
    studentEmail: "nour@example.com",
    studentName: "Nour Hassan",
    settlementMode: "pay_at_studio",
    confirmedPaymentMethod: "cash",
  });
  assert.equal(withoutField.success, true);

  const withNumber = CheckInBodyExtended.safeParse({
    studentEmail: "nour@example.com",
    studentName: "Nour Hassan",
    settlementMode: "pay_at_studio",
    confirmedPaymentMethod: "cash",
    expectedPriceEgp: 250,
  });
  assert.equal(withNumber.success, true);
});

// ─── Booking flow (Fix 1) ───────────────────────────────────────────────────

test("bookings.ts: expectedPriceEgp is stripped out before normalizeBookingWrite — never spread into the bookingsTable insert", () => {
  assert.match(
    bookingsRoute,
    /const\s*\{\s*expectedPriceEgp,[\s\S]{0,300}?\.\.\.bookingFields\s*\}\s*=\s*parsed\.data/,
    "expectedPriceEgp must be destructured out of parsed.data before it reaches normalizeBookingWrite/the insert",
  );
  assert.match(
    bookingsRoute,
    /normalizeBookingWrite\(\{\s*\n?\s*\.\.\.bookingFields,/,
    "normalizeBookingWrite must be called with bookingFields (expectedPriceEgp excluded), not the raw parsed.data",
  );
});

test("bookings.ts: the stale-price check runs BEFORE the bookings insert — a mismatch can never create a booking or payment_records row", () => {
  const priceCheckIndex = bookingsRoute.indexOf("kind: \"price_changed\" as const");
  const insertIndex = bookingsRoute.indexOf(".insert(bookingsTable)\n      .values({");
  assert.ok(priceCheckIndex > 0, "price_changed guard must exist");
  assert.ok(insertIndex > 0, "bookings insert must exist");
  assert.ok(
    priceCheckIndex < insertIndex,
    "the price mismatch check must be resolved before the bookings insert, so a mismatch writes nothing",
  );
});

test("bookings.ts: the mismatch comparison uses egpToMinor on both sides (no float/unit mismatch) and only applies when expectedPriceEgp is provided", () => {
  assert.match(
    bookingsRoute,
    /expectedPriceEgp\s*!=\s*null\s*&&\s*\n\s*egpToMinor\(expectedPriceEgp\)\s*!==\s*egpToMinor\(priceEgp\)/,
    "an omitted expectedPriceEgp (older client) must skip the check entirely",
  );
});

test("bookings.ts: price_changed maps to a 409 with a stable code and the current price, and does not reuse another kind's status", () => {
  const block = bookingsRoute.slice(bookingsRoute.indexOf('createResult.kind === "price_changed"'));
  assert.match(block, /res\.status\(409\)/);
  assert.match(block, /code:\s*"booking_price_changed"/);
  assert.match(block, /currentPriceEgp:\s*createResult\.currentPriceEgp/);
});

test("bookings.ts: the resolved price is computed exactly once per request and reused for the payment_records snapshot (no second re-resolution that could disagree)", () => {
  const occurrences = bookingsRoute.match(/resolveSingleClassPriceEgp\(tx,/g) ?? [];
  assert.equal(
    occurrences.length,
    1,
    "resolveSingleClassPriceEgp should be called once inside the transaction and its result reused, not re-resolved after the insert",
  );
});

// ─── Mobile (Fix 1) ─────────────────────────────────────────────────────────

test("booking flow: expectedPriceEgp sends the undiscounted server-priced amount for a direct-payment booking", () => {
  assert.match(
    flowScreen,
    /expectedPriceEgp:\s*apiPaymentMode === "pay_at_studio"\s*\n?\s*\?\s*grossPrice/,
    "expectedPriceEgp must carry the undiscounted class price; promo-adjusted totals are bound separately by expectedFinalPriceEgp",
  );
});

test("booking flow: a 409 booking_price_changed response is handled without creating a misleading generic failure, and invalidates the stale cached price", () => {
  assert.match(flowScreen, /booking_price_changed/);
  assert.match(flowScreen, /invalidateQueries\(\{\s*queryKey:\s*\["class-pricing"\]\s*\}\)/);
});

// ─── Legacy walk-in endpoint (Fix 3) ────────────────────────────────────────

test("attendance.ts: expectedPriceEgp is threaded from the request into performStudioWalkIn on the pay_at_studio branch", () => {
  const payAtStudioBranch = attendanceRoute.slice(
    attendanceRoute.indexOf('settlementMode === "pay_at_studio"'),
    attendanceRoute.indexOf('if (settlementMode === "package_credit")'),
  );
  assert.match(payAtStudioBranch, /performStudioWalkIn\(tx,/);
  assert.match(payAtStudioBranch, /expectedPriceEgp:\s*expectedPriceEgp\s*\?\?\s*null/);
});

test("attendance.ts: the legacy-endpoint keep/deprecate decision is documented in place, not left implicit", () => {
  assert.match(attendanceRoute, /Legacy-endpoint decision/);
  assert.match(attendanceRoute, /scan-check-in-dialog\.tsx/);
  assert.match(attendanceRoute, /not rendered anywhere/);
  assert.match(attendanceRoute, /kept.{0,20}NOT deprecated\/removed/s);
});

// ─── Consistency across both walk-in entry points ──────────────────────────

test("both walk-in entry points (canonical gateway and legacy /attendance) rely on the SAME performStudioWalkIn guard — no separate price-comparison logic exists", () => {
  assert.match(adminGatewayRoute, /performStudioWalkIn\(tx,/);
  assert.match(adminGatewayRoute, /expectedPriceEgp:/);
  assert.match(attendanceRoute, /performStudioWalkIn\(tx,/);
  assert.match(attendanceRoute, /expectedPriceEgp:/);
  // The guard itself — comparison + rejection — is implemented exactly once,
  // in the shared function both routes call into.
  const guardOccurrences = checkInService.match(/params\.expectedPriceEgp\s*!=\s*null/g) ?? [];
  assert.equal(guardOccurrences.length, 1, "the stale-price comparison must live in exactly one place (performStudioWalkIn), not be duplicated per route");
});
