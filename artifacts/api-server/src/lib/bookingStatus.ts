// Centralized booking-status policy. Use these instead of scattering manual
// status string checks across routes.
//
// Lifecycle:
//   pending   — request exists, seat NOT reserved (default for student bookings:
//               pay-on-arrival AND package; Admin must confirm).
//   confirmed — Admin approved; seat is reserved (counts in bookedCount / capacity).
//   rejected  — Admin rejected; no seat; does not block future booking.
//   attended  — student attended (counts as a used/reserved seat + history).
//   cancelled / completed — legacy statuses, kept for history (see report). Not
//               used to reserve a seat.
//   attendance_reversed — terminal historical evidence that an attended
//               booking was later reversed; never a cancellation or free seat.

/** Statuses that RESERVE a seat → counted in bookedCount / progress / capacity. */
export const RESERVED_SEAT_STATUSES = ["confirmed", "attended", "attendance_reversed"] as const;

/** Statuses that BLOCK a duplicate request for the same occurrence (a live
 *  request the user already owns), even though `pending` does not reserve a seat. */
export const DUPLICATE_BLOCKING_STATUSES = ["pending", "confirmed"] as const;

export function isSeatReservedBooking(b: { bookingStatus: string }): boolean {
  return (RESERVED_SEAT_STATUSES as readonly string[]).includes(b.bookingStatus);
}

export function isDuplicateBlockingBooking(b: { bookingStatus: string }): boolean {
  return (DUPLICATE_BLOCKING_STATUSES as readonly string[]).includes(b.bookingStatus);
}
