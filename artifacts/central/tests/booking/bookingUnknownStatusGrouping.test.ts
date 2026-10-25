/**
 * F-08 correction: an unknown/unrecognized bookingStatus (e.g. the
 * backend's real "attendance_reversed", surfaced locally as "unknown" —
 * see utils/bookingStatus.ts) must never be grouped into the Upcoming tab
 * or rendered as an active, cancellable booking. Before this fix, the old
 * mapApiStatusToLocal fallback silently produced "confirmed", which every
 * isPast/isUpcoming check below treated as a normal active booking.
 *
 * BookingCard.tsx and app/(tabs)/bookings.tsx are Expo Router
 * components (JSX, react-native imports) that cannot be imported into a
 * plain Node test process — this follows the repo's established
 * source-assertion convention (see bookingCancellationConsistency.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { loadStatusUI } from "./bookingStatusHarness";

const SCREEN = "artifacts/central/app/(tabs)/bookings.tsx";
const screenSource = readFileSync(resolve(process.cwd(), SCREEN), "utf8");

test("BookingCard renders an unknown bookingStatus neutrally without inferring availability", () => {
  const { module } = loadStatusUI("components/BookingCard.tsx");
  assert.equal(module.bookingStatusConfig("unknown").label, "Unknown");
});

test("the bookings screen's shared item renderer treats an unknown bookingStatus as past", () => {
  assert.match(
    screenSource,
    /: \(b\.bookingStatus === "attended" \|\| b\.bookingStatus === "completed" \|\| b\.bookingStatus === "noShow" \|\| b\.bookingStatus === "unknown"\);/,
    "the shared list-item isPast must include the unknown status so canCancel (which is derived from isPast) is never true for it",
  );
});

test("mergedBookings forces an unknown-status booking into the past regardless of its date", () => {
  assert.match(
    screenSource,
    /if \(b\.bookingStatus === "attended" \|\| b\.bookingStatus === "noShow" \|\| b\.bookingStatus === "completed" \|\| b\.bookingStatus === "unknown"\) \{\s*isPast = true;/,
    "an unknown-status booking with a future date must still be forced into _isPast, so it lands in the Past tab, not Upcoming",
  );
});

test("bookingStatusConfig gives 'unknown' its own neutral label, distinct from Confirmed", () => {
  const { module } = loadStatusUI("components/BookingCard.tsx");
  const unknown = module.bookingStatusConfig("unknown");
  assert.equal(unknown.label, "Unknown");
  assert.equal(unknown.color, "#B6BDC6");
  assert.notEqual(unknown.label, module.bookingStatusConfig("confirmed").label);
  assert.notEqual(unknown.color, module.bookingStatusConfig("confirmed").color);
});
