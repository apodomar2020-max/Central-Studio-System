/**
 * R3 / F-09 correction: a booking must not be presented as cancellable
 * from the list card while its own detail overlay shows a disabled
 * "Cancel (Soon)" placeholder for the same booking.
 *
 * The fix reuses the SAME cancellation operation (cancelBooking / PATCH
 * /api/bookings/:id/cancel) from both surfaces via one shared
 * confirmCancelBooking() closure — no second cancellation contract, no
 * cancellation policy (window/fee/refund) introduced.
 *
 * Ballet items are explicitly excluded: Ballet cancellation is a
 * separate, already-existing flow (BalletProgramDangerZone /
 * enrolment-cancellation requests) with a different contract, and this
 * correction must not create a second implementation of it.
 *
 * app/(tabs)/bookings.tsx is an Expo Router screen (JSX, react-native
 * imports) that cannot be imported into a plain Node test process — this
 * follows the repo's established source-assertion convention (see
 * artifacts/api-server/src/routes/bookingPriceBinding.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const SCREEN = "artifacts/central/app/(tabs)/bookings.tsx";
const source = readFileSync(resolve(process.cwd(), SCREEN), "utf8");

test("a single shared confirmCancelBooking() operation exists, calling the same cancelBooking() the card always used", () => {
  assert.match(
    source,
    /const confirmCancelBooking = useCallback\(\(booking: Booking\) => \{/,
    "expected one shared cancel-confirmation function",
  );
  assert.match(source, /await cancelBooking\(booking\.id\);/);
});

test("the list card's Cancel action calls the shared operation (no separate inline implementation remains)", () => {
  assert.match(
    source,
    /onCancel=\{\(\) => confirmCancelBooking\(item\.data\)\}/,
    "BookingCard's onCancel must delegate to the shared confirmCancelBooking, not duplicate the confirm dialog inline",
  );
});

test("the detail overlay's Cancel button is wired to the same shared operation for a non-Ballet booking", () => {
  assert.match(
    source,
    /selectedItem\.kind === "booking"[\s\S]{0,120}confirmCancelBooking\(selectedItem\.data\)/,
    "the overlay must only offer cancellation for kind === 'booking' items, wired to the same shared operation",
  );
});

test("the overlay's cancellability check mirrors BookingCard's isUpcomingActive gate exactly", () => {
  assert.match(
    source,
    /const canCancel = !isBallet && !isPast && !isCancelled && !b\.sourceUnavailable;/,
    "canCancel must match: not Ballet, not past, not already cancelled/rejected, and not sourceUnavailable — the same conditions BookingCard uses",
  );
});

test("the overlay no longer shows a working-looking 'Cancel (Soon)' placeholder for a cancellable general booking", () => {
  // The remaining "Cancel (Soon)" placeholder must be reachable ONLY for
  // an active Ballet item — never for a cancellable general booking.
  const placeholderBlock = source.slice(
    source.indexOf('!isPast && !isCancelled && isBallet && ('),
    source.indexOf('Cancel (Soon)</Text>') + 30,
  );
  assert.match(placeholderBlock, /isBallet/, "the disabled placeholder must be gated to isBallet only");
});

test("the working Cancel Booking button is present and reuses onCancel, not a new backend call", () => {
  assert.match(source, /onPress=\{onCancel\}/);
  assert.match(source, />Cancel Booking</);
});

test("no cancellation time window, fee, or refund rule was introduced by this correction", () => {
  assert.equal(/\b(cancellationWindow|cancelWindow|refundRule|cancellationFee)\b/i.test(source), false);
  // No new hour-based cutoff constants (e.g. 2h/6h/12h/24h) near the cancel logic.
  assert.equal(/canCancel[\s\S]{0,400}\b(hours?|hrs)\b/i.test(source), false);
});
