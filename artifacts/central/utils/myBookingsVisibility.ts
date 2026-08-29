import { bookingOccurrenceStartMs } from "./bookingCancellationEligibility";

/** The small slice of a booking needed by My Bookings and its Profile count. */
export type MyBookingsVisibilityInput = {
  bookingStatus?: string | null;
  occurrenceDate?: string | null;
  date?: string | null;
  scheduleStartTime?: string | null;
  time?: string | null;
  sourceUnavailable?: boolean | null;
  classId?: string | number | null;
  bookingType?: string | null;
  danceType?: string | null;
  className?: string | null;
};

/**
 * Single source of truth for the general-class bookings shown in My Bookings.
 * Cancelled/rejected bookings represent a completed deletion from the user's
 * upcoming list, and Ballet has its own dedicated section.
 */
export function isVisibleUpcomingMyBooking(
  booking: MyBookingsVisibilityInput,
  nowMs: number = Date.now(),
): boolean {
  if (booking.bookingStatus !== "pending" && booking.bookingStatus !== "confirmed") return false;
  if (booking.sourceUnavailable || !booking.classId) return false;

  const isBallet = booking.bookingType === "ballet"
    || /\bballet\b/i.test(booking.danceType || "")
    || /\bballet\b/i.test(booking.className || "");
  if (isBallet) return false;

  const rawDate = booking.occurrenceDate || booking.date || "";
  const rawTime = booking.scheduleStartTime || booking.time || "";
  const dateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(rawDate)?.[1];
  const timeOnly = /(\d{1,2}:\d{2})/.exec(rawTime)?.[1];
  if (!dateOnly || !timeOnly) return false;

  const occurrenceStart = bookingOccurrenceStartMs({
    occurrenceDate: dateOnly,
    startTime: timeOnly,
  });
  return occurrenceStart != null && occurrenceStart >= nowMs;
}
