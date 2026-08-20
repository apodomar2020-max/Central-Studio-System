/**
 * Wave 3 (F-20): the 2-hour self-cancellation cutoff for regular class
 * bookings.
 *
 * Policy (owner-approved): a student may self-cancel a booking only while
 * time-until-class-start >= 2 hours.
 *   - exactly 2h before start: allowed
 *   - more than 2h before start: allowed
 *   - less than 2h before start: blocked
 *   - at/after start: blocked
 *
 * Uses the SAME canonical instant-conversion primitive
 * (cairoDateTimeToUtcMs) that check-in/attendance windows already use —
 * no second time source is invented here. The booking's own occurrenceDate
 * (locked in at booking time) is the source of the class date; the
 * schedule's startTime is the source of the class's start-of-day time.
 *
 * Pure and DB-free so the boundary (exactly 2h, 1 second under, 1 second
 * over) can be tested deterministically without a database.
 */
import { cairoDateTimeToUtcMs } from "./occurrence";

/** Minutes before class start that self-cancellation remains allowed. */
export const SELF_CANCEL_CUTOFF_MINUTES = 120;

export type BookingCancellationEligibility =
  | { eligible: true }
  | { eligible: false; reason: "too_close_to_start" | "occurrence_unresolvable" };

/**
 * `occurrenceDate` is the booking's own locked-in occurrence date
 * ("YYYY-MM-DD"); `startTime` is the schedule's start time ("HH:MM[:SS]").
 * Either missing means the class start instant cannot be resolved — treated
 * as NOT eligible (never silently permissive) rather than guessing.
 */
export function evaluateBookingCancellationEligibility(
  params: { occurrenceDate: string | null | undefined; startTime: string | null | undefined },
  now: Date = new Date(),
): BookingCancellationEligibility {
  if (!params.occurrenceDate || !params.startTime) {
    return { eligible: false, reason: "occurrence_unresolvable" };
  }
  const occurrenceStartMs = cairoDateTimeToUtcMs(params.occurrenceDate, params.startTime);
  const cutoffMs = occurrenceStartMs - SELF_CANCEL_CUTOFF_MINUTES * 60_000;
  if (now.getTime() > cutoffMs) {
    return { eligible: false, reason: "too_close_to_start" };
  }
  return { eligible: true };
}

/** Convenience boolean for callers that only need the yes/no answer. */
export function isBookingSelfCancellable(
  params: { occurrenceDate: string | null | undefined; startTime: string | null | undefined },
  now: Date = new Date(),
): boolean {
  return evaluateBookingCancellationEligibility(params, now).eligible;
}
