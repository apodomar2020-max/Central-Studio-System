/**
 * Legacy Referral system — permanently retired.
 *
 * The prior implementation was entirely client-local: no backend/API/schema
 * model ever existed (grep-verified across artifacts/api-server, artifacts/admin,
 * lib/api-zod, and the DB schema — zero results). This proves the client-side
 * removal only; there is no backend contract to preserve or version.
 *
 * app/booking/flow.tsx and contexts/AppContext.tsx are Expo Router / React
 * Context files that cannot be imported into a plain Node test process —
 * this follows the repo's established source-assertion convention (see
 * flow.duplicateBooking.test.ts, firstClassFreeRetirement.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const flow = read("artifacts/central/app/booking/flow.tsx");
const appContext = read("artifacts/central/contexts/AppContext.tsx");
const layout = read("artifacts/central/app/_layout.tsx");
const navigation = read("artifacts/central/utils/navigation.ts");

test("the referral screen file no longer exists", () => {
  assert.throws(() => read("artifacts/central/app/referral.tsx"));
});

test("the referral screen is no longer registered in the router Stack", () => {
  assert.equal(/name="referral"/.test(layout), false);
});

test("a stale CMS/deep-link path to /referral fails safely instead of crashing", () => {
  // isSafeAppRoute's KNOWN_ROOT_SEGMENTS no longer allowlists "referral" —
  // safePush("/referral") now returns false and never calls router.push,
  // exactly like any other unknown/unsupported destination.
  assert.equal(/"referral"/.test(navigation), false);
  assert.match(navigation, /KNOWN_ROOT_SEGMENTS/);
});

test("booking checkout no longer exposes a referral code input, apply button, or applied state", () => {
  assert.equal(/refCodeInput|appliedCode|refCodeState|handleApplyRefCode/.test(flow), false);
  assert.equal(/Have a referral code\?|Referral Applied!/.test(flow), false);
});

test("new booking requests no longer append a referral code line to notes", () => {
  assert.equal(/Referral code:/.test(flow), false);
  // The other two note lines (participant, package-credit-intent) remain —
  // proving this was a scoped removal, not a rewrite of notes handling.
  assert.match(flow, /Participant: \$\{participantName\}/);
  assert.match(flow, /Package credit intent:/);
});

test("no referral state, generation, or persistence remains in AppContext", () => {
  assert.equal(/referralCode|referralCredits|generateCode\(/.test(appContext), false);
  assert.equal(/AsyncStorage\.(get|set)Item\("referralCode"\)/.test(appContext), false);
});

test("Promotion/discount code handling in the booking flow is untouched (referral and promotions are separate)", () => {
  // This file makes no claim about promo-code UI existing (none did before
  // this change either) — it only proves this removal did not touch
  // pricing/discount computation, which lives in resolveSingleClassPriceEgp
  // and is exercised by the Finance/Pricing protected suite separately.
  assert.match(flow, /finalPrice/);
});
