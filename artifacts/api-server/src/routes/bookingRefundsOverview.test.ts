/**
 * Wave 3.1 (Gap 2) — the Admin refund dialog needs a single combined
 * read (eligibility + the existing refund row, if any) to render without
 * two separate round-trips or duplicated frontend logic. Proves the new
 * read-only overview is additive: it calls the existing
 * bookingRefundEligibility() unchanged and does not touch any
 * request/approve/reject/complete/fail lifecycle function.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const SERVICE = "artifacts/api-server/src/lib/bookingRefundService.ts";
const ROUTE = "artifacts/api-server/src/routes/bookingRefunds.ts";
const serviceSource = readFileSync(resolve(process.cwd(), SERVICE), "utf8");
const routeSource = readFileSync(resolve(process.cwd(), ROUTE), "utf8");

test("getBookingRefundOverview is read-only: it calls bookingRefundEligibility, never a lifecycle-mutating function", () => {
  const start = serviceSource.indexOf("export async function getBookingRefundOverview");
  const end = serviceSource.indexOf("\n}\n", start);
  const body = serviceSource.slice(start, end);
  assert.match(body, /const eligibility = await bookingRefundEligibility\(bookingId\);/);
  assert.equal(/requestBookingRefundInTx|approveBookingRefund|rejectBookingRefund|completeBookingRefund|failBookingRefund/.test(body), false);
});

test("the overview route is mounted under the same view guards as the eligibility route (view-only, no new permission)", () => {
  assert.match(routeSource, /router\.get\("\/admin\/bookings\/:id\/refund", \.\.\.viewGuards,/);
});

test("the overview route calls only the read-only service function", () => {
  const start = routeSource.indexOf('router.get("/admin/bookings/:id/refund",');
  const end = routeSource.indexOf("});", start);
  const body = routeSource.slice(start, end);
  assert.match(body, /getBookingRefundOverview\(id\)/);
});
