/**
 * F-17 — First Class Free is permanently retired as a standalone feature.
 *
 * Proves, by source inspection of app/booking/flow.tsx (a Node-test-runner
 * file lives outside the Expo Router `app/` directory per the repo's own
 * established convention — see flow.duplicateBooking.test.ts):
 *
 *   - the client never constructs paymentMode:"free" for any booking, for
 *     any reason, including a zero-priced class
 *   - package-credit bookings are unaffected (still "not_required" /
 *     "package_credit")
 *   - every other booking (Pay-at-Studio, any price including 0) always
 *     goes through the normal "pay_at_studio" / "pending_payment" flow —
 *     a zero/missing price is never silently reinterpreted as the retired
 *     free-booking path
 *   - no dead First Class Free UI state (isFirstBooking, the hardcoded-off
 *     gate) or customer-facing copy ("Your First Class Is FREE",
 *     "Confirm Free Class", the New Member Welcome -100% row) remains
 *   - the removed NewStudentBanner component and its AppContext dismiss
 *     plumbing (newStudentBannerDismissed / dismissNewStudentBanner) are
 *     fully gone, not just hidden behind a false flag
 *
 * Also proves the boundary: this must NOT have touched Promotions/offer
 * display (OfferCard's generic 100%-discount rendering) or Ballet's own
 * unrelated "Free / No Fee" assessment-status copy.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const flow = read("artifacts/central/app/booking/flow.tsx");
const appContext = read("artifacts/central/contexts/AppContext.tsx");
const homeScreen = read("artifacts/central/app/(tabs)/index.tsx");
const offerCard = read("artifacts/central/components/OfferCard.tsx");
const balletSummaryCard = read("artifacts/central/components/ballet/BalletAssessmentSummaryCard.tsx");

test("the booking flow never constructs paymentMode:\"free\" — package-credit or pay_at_studio only", () => {
  assert.match(flow, /const apiPaymentMode = isPackageMode \? "package_credit" : "pay_at_studio";/);
  assert.equal(/apiPaymentMode\s*=[\s\S]{0,80}"free"/.test(flow), false, "no code path may assign the string \"free\" to apiPaymentMode");
});

test("paymentStatus for a non-package booking is always pending_payment, regardless of price", () => {
  assert.match(flow, /const apiPaymentStatus = isPackageMode \? "not_required" : "pending_payment";/);
});

test("a zero-priced class (finalPrice === 0) no longer branches into a different payment mode", () => {
  // The old F-17 branch used `finalPrice === 0 ? ... : ...` directly inside
  // the apiPaymentMode/apiPaymentStatus assignment — confirm that specific
  // conditional is gone from those two lines.
  const paymentModeLine = flow.split("\n").find((line) => line.includes("const apiPaymentMode ="));
  const paymentStatusLine = flow.split("\n").find((line) => line.includes("const apiPaymentStatus ="));
  assert.ok(paymentModeLine && !paymentModeLine.includes("finalPrice"));
  assert.ok(paymentStatusLine && !paymentStatusLine.includes("finalPrice"));
});

test("no dead isFirstBooking flag or First Class Free UI/copy remains in the booking flow", () => {
  assert.equal(/isFirstBooking/.test(flow), false);
  assert.equal(/Your First Class Is FREE/.test(flow), false);
  assert.equal(/Confirm Free Class/.test(flow), false);
  assert.equal(/NEW_MEMBER_OFFER_TITLE/.test(flow), false);
  assert.equal(/-100%/.test(flow), false);
});

test("the real payment-method selection UI (Pay at Studio / package credit / coming-soon card) is still present and unconditional", () => {
  assert.match(flow, /Pay at Studio/);
  assert.match(flow, /Take From My Credits/);
  assert.match(flow, /Pay Now - Coming Soon/);
});

test("the NewStudentBanner component file no longer exists", () => {
  assert.throws(() => read("artifacts/central/components/NewStudentBanner.tsx"));
});

test("no reference to the removed NewStudentBanner or its dismiss plumbing remains anywhere", () => {
  for (const source of [flow, appContext, homeScreen]) {
    assert.equal(/NewStudentBanner/.test(source), false);
    assert.equal(/newStudentBannerDismissed/.test(source), false);
    assert.equal(/dismissNewStudentBanner/.test(source), false);
    assert.equal(/showNewStudentBanner/.test(source), false);
  }
});

test("backend defense-in-depth for paymentMode \"free\" is untouched — not this wave's concern to remove", () => {
  const bookingsRoute = read("artifacts/api-server/src/routes/bookings.ts");
  assert.match(bookingsRoute, /if \(normalized\.paymentMode === "free"\) \{/);
  assert.match(bookingsRoute, /Free class booking is currently disabled\./);
});

test("boundary: Promotions/offer generic 100%-discount display is untouched (not F-17-specific)", () => {
  assert.match(offerCard, /discountValue === 100 \? "FREE"/);
});

test("boundary: Ballet's own unrelated assessment fee copy is untouched (not F-17-specific)", () => {
  assert.match(balletSummaryCard, /Free \/ No Fee/);
});
