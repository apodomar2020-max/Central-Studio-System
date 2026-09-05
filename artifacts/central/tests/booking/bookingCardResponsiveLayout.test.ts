import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BOOKING_CARD_MAX_HEIGHT,
  BOOKING_CARD_MAX_WIDTH,
  BOOKING_CARD_MIN_HEIGHT,
  bookingCardHeightForWidth,
} from "../../utils/bookingCardLayout.ts";

const cardSource = readFileSync(new URL("../../components/BookingCard.tsx", import.meta.url), "utf8");
const bookingsSource = readFileSync(new URL("../../app/(tabs)/bookings.tsx", import.meta.url), "utf8");

test("booking card scales with normal phone widths and keeps a safe narrow-phone height", () => {
  assert.equal(bookingCardHeightForWidth(286), BOOKING_CARD_MIN_HEIGHT);
  assert.equal(bookingCardHeightForWidth(356), 262);
  assert.equal(bookingCardHeightForWidth(396), 291);
});

test("booking card stops stretching on tablets and foldables", () => {
  assert.equal(bookingCardHeightForWidth(700), BOOKING_CARD_MAX_HEIGHT);
  assert.equal(bookingCardHeightForWidth(700), bookingCardHeightForWidth(BOOKING_CARD_MAX_WIDTH));
});

test("time-left bar is attached to the bottom of the glass panel with fluid side insets", () => {
  assert.match(cardSource, /countdownPill: \{[^}]*left: "8%", right: "8%", bottom: 10/);
  assert.doesNotMatch(cardSource, /countdownPill: \{[^}]*top:/);
  assert.match(cardSource, /panelShell: \{[^}]*bottom: 10, height: "52%"/);
});

test("long variable text remains on one line inside the responsive card", () => {
  assert.match(cardSource, /className\} numberOfLines=\{1\}/);
  assert.match(cardSource, /countdownText\} numberOfLines=\{1\} adjustsFontSizeToFit minimumFontScale=\{0\.78\}/);
});

test("glass panel stays a single clipped surface with only a restrained lower highlight", () => {
  assert.match(cardSource, /panelShell: \{[^\n]*overflow: "hidden"[^\n]*backgroundColor: "rgba\(2,25,29,0\.62\)"/);
  assert.doesNotMatch(cardSource, /panelSurface:/);
  assert.match(cardSource, /panelBottomHighlight: \{[^\n]*height: StyleSheet\.hairlineWidth[^\n]*backgroundColor: "rgba\(255,255,255,0\.16\)"/);
});

test("booking details navigation ignores repeated taps until the list regains focus", () => {
  assert.match(bookingsSource, /if \(bookingNavigationLockedRef\.current\) return;/);
  assert.match(bookingsSource, /bookingNavigationLockedRef\.current = true;[\s\S]*router\.push\(\{ pathname: "\/booking\/\[id\]"/);
  assert.match(bookingsSource, /bookingNavigationLockedRef\.current = false;/);
  assert.match(bookingsSource, /onPress=\{\(\) => openBookingDetails\(item\.data\.id\)\}/);
});
