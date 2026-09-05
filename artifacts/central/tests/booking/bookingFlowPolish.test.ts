import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FALLBACK_PROMO_ERROR, getFriendlyPromoError } from "../../components/booking/promoError";

const flow = readFileSync(new URL("../../app/booking/flow.tsx", import.meta.url), "utf8");
const confirmation = readFileSync(new URL("../../app/booking/confirmation.tsx", import.meta.url), "utf8");
const participantAvatar = readFileSync(new URL("../../components/ParticipantAvatar.tsx", import.meta.url), "utf8");
const bookingFlowIcon = readFileSync(new URL("../../components/booking/BookingFlowIcon.tsx", import.meta.url), "utf8");
const packageCenter = readFileSync(new URL("../../app/package-center.tsx", import.meta.url), "utf8");
const availablePackages = readFileSync(new URL("../../components/AvailablePackagesSection.tsx", import.meta.url), "utf8");

test("technical promo validation payloads are never shown to the customer", () => {
  const message = getFriendlyPromoError({
    data: {
      error: JSON.stringify([{
        code: "invalid_type",
        expected: "number",
        received: "nan",
        path: ["packageId"],
      }]),
    },
  });
  assert.equal(message, FALLBACK_PROMO_ERROR);
  assert.doesNotMatch(message, /invalid_type|packageId|nan/i);
});

test("known promo errors use customer-facing copy", () => {
  assert.equal(
    getFriendlyPromoError({ data: { code: "promotion_not_eligible" } }),
    "This promo code is not eligible for the selected class.",
  );
});

test("Details keeps the promo input inline and fixes the price summary with the rounded CTA", () => {
  assert.match(flow, /promoExpanded \? \(\s*<View style=\{styles\.promoInputWrap\}>/);
  assert.match(flow, /step === 3 \? styles\.detailsFooter : styles\.footer/);
  assert.match(flow, /roundedCta:\s*\{ borderRadius: 999 \}/);
  assert.match(flow, /detailHint:[^\n]+color: "#FFFFFF"/);
});

test("selected participant and package-credit controls keep the same visible cyan selection treatment", () => {
  assert.match(flow, /selected=\{participantType === "self"\}/);
  assert.match(flow, /selected=\{participantType === "child" && selectedChildId === child\.id\}/);
  assert.match(flow, /paymentOptionSelected:\s*\{ backgroundColor: colors\.studio\.primary \}/);
  assert.match(flow, /participantSubSelected:\s*\{ color: "#012329"/);
  assert.match(participantAvatar, /backgroundColor: selected \? "#012C31"/);
  assert.match(participantAvatar, /borderColor: genderColor/);
});

test("customers without package credit get a Package Center shortcut instead of a hidden credit row", () => {
  assert.match(flow, /const shouldShowBuyCredits = packageCreditsRemaining <= 0;/);
  assert.match(flow, /shouldShowBuyCredits \? \([\s\S]*>BUY CREDIT<\/Text>/);
  assert.match(flow, /No Credits Available\. Buy A Package For \{classPackageAgeLabel\} To Book This Class/);
  assert.match(flow, /accessibilityLabel="Buy credits from Package Center"/);
  assert.match(flow, /pushOnce\(\{ pathname: "\/package-center", params: \{ ageBand: classPackageAgeBand \} \} as never\)/);
  assert.match(flow, /BookingFlowIcon name="route" size=\{22\}/);
  assert.match(bookingFlowIcon, /route: require\("@\/assets\/icons\/booking-route\.svg"\)/);
});

test("Package Center opens the requested class age category and exposes Adults, Teens, and Kids filters", () => {
  assert.match(packageCenter, /useLocalSearchParams<\{ ageBand\?: string \| string\[\] \}>/);
  assert.match(packageCenter, /initialAgeFilter=\{requestedAgeBand \?\? undefined\}/);
  assert.match(availablePackages, /const PACKAGE_FILTERS: PackageAgeBand\[\] = \["adults", "teens", "kids"\]/);
  assert.match(availablePackages, /packages\.filter\(\(pkg\) => packageMatchesAgeBand\(pkg, ageFilter\)\)/);
  assert.match(availablePackages, /accessibilityRole="tab"/);
});

test("booking success is a responsive scroll surface and uses the supplied action icons", () => {
  assert.match(confirmation, /<ScrollView[\s\S]*contentContainerStyle=\{\[styles\.canvas,/);
  assert.match(confirmation, /canvas: \{ width: "100%", maxWidth: 430/);
  assert.doesNotMatch(confirmation, /canvas: \{ flex: 1/);
  for (const name of ["bell", "calendar", "home"]) {
    assert.match(confirmation, new RegExp(`BookingSuccessActionIcon name="${name}"`));
  }
  assert.match(confirmation, /styles\.referenceCopyRight/);
});
