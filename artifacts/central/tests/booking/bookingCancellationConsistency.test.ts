/**
 * My Bookings keeps cancellation out of the compact list card. The action
 * remains available from the booking details surface, where the customer has
 * the full class context before confirming a destructive action.
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
const detailRoute = readFileSync(resolve(process.cwd(), "artifacts/central/app/booking/[id].tsx"), "utf8");
const detailView = readFileSync(resolve(process.cwd(), "artifacts/central/components/BookingDetailsView.tsx"), "utf8");

test("a single shared confirmCancelBooking() operation exists, calling the same cancelBooking() the card always used", () => {
  assert.match(
    source,
    /const confirmCancelBooking = useCallback\(\(booking: Booking\) => \{/,
    "expected one shared cancel-confirmation function",
  );
  assert.match(source, /await cancelBooking\(booking\.id\);/);
});

test("the compact list card does not expose cancellation or the removed participant row", () => {
  const listCardCall = source.slice(
    source.indexOf("<BookingCard"),
    source.indexOf("</TouchableOpacity>", source.indexOf("<BookingCard")),
  );
  assert.doesNotMatch(listCardCall, /onCancel=/);
  assert.doesNotMatch(listCardCall, /participantImage=/);
});

test("the standalone booking details route keeps the cancellation action", () => {
  assert.match(detailRoute, /onCancel=\{confirmCancel\}/);
  assert.match(detailView, /onPress=\{\(\) => \{[\s\S]{0,120}onCancel\?\.\(\)/);
});

test("the overlay's cancellability check mirrors BookingCard's isUpcomingActive gate exactly", () => {
  assert.match(
    source,
    /const canCancel = !isBallet && !isPast && !isCancelled && !b\.sourceUnavailable\s*\n\s*&& isBookingSelfCancellableClientSide\(/,
    "canCancel must match: not Ballet, not past, not already cancelled/rejected, not sourceUnavailable, and within the Wave 3 2-hour self-cancellation window — the same conditions BookingCard uses",
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

// Superseded by Wave 3 (F-20): the owner-approved policy is a real 2-hour
// self-cancellation cutoff, applied identically on both surfaces via the
// SHARED isBookingSelfCancellableClientSide utility — never a second,
// locally-invented window/fee/refund rule duplicated inline in this file.
test("the 2-hour cutoff is applied via the shared utility, not a locally re-invented window/fee rule", () => {
  assert.match(detailView, /import \{ isBookingSelfCancellableClientSide \} from "@\/utils\/bookingCancellationEligibility";/);
  assert.equal(/\b(cancellationWindow|cancelWindow|refundRule|cancellationFee)\b/i.test(detailView), false);
  // No ad-hoc hour-based constant (e.g. a bare "2", "120", "hours") is
  // computed inline here — the only cutoff math lives in the shared utility.
  assert.equal(/const canCancel[\s\S]{0,400}\b(hours?|hrs)\b/i.test(detailView), false);
});
