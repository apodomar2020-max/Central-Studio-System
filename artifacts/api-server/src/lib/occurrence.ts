// Cairo-time occurrence helpers. These MIRROR the mobile
// getNextScheduleOccurrenceDate logic so a booking's occurrence key lines up
// across the backend and the app.
//
// A booking is identified by (student + schedule + occurrence). For a weekly
// schedule the "current upcoming occurrence" is today's date if the current Cairo
// time is before the schedule's start time, otherwise the next matching weekday —
// so once today's class starts, the schedule becomes bookable again for next week.

export interface OccurrenceSchedule {
  type: string;
  date?: string | null;
  dayOfWeek?: number | null; // 0=Sunday .. 6=Saturday
  startTime?: string | null; // "HH:MM" or "HH:MM:SS"
}

export function cairoNow(now: Date = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function dayOfWeekFromIso(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Current/next upcoming occurrence date (YYYY-MM-DD) for a schedule, in Cairo
 * time. Returns null if it can't be determined (e.g. weekly with no dayOfWeek).
 *
 * NOTE: this is the BOOKING-side helper — it rolls a weekly schedule to next
 * week once today's class has started, so the schedule becomes bookable again.
 * It is NOT used for check-in eligibility (which must keep today's occurrence
 * valid all day — see checkInWindowState below).
 */
export function currentOccurrenceDate(
  schedule: OccurrenceSchedule,
  now = cairoNow(),
): string | null {
  if (schedule.type === "one_time") return schedule.date ?? null;
  if (schedule.dayOfWeek == null) return null;
  const todayDow = dayOfWeekFromIso(now.date);
  let delta = (((schedule.dayOfWeek - todayDow) % 7) + 7) % 7;
  if (delta === 0 && now.time >= (schedule.startTime ?? "00:00")) {
    delta = 7; // today's occurrence already started → roll to next week
  }
  return addDays(now.date, delta);
}

// ---------------------------------------------------------------------------
// Check-in eligibility window (Phase A)
//
// A booking is eligible for QR check-in only on the booking's stored
// occurrence date, and only inside a grace window that opens 2 hours before
// the class start time and stays open until the end of that Cairo day.
//
// Unlike currentOccurrenceDate(), this does NOT roll a weekly class to next
// week once it has started — today's occurrence stays valid all day so a
// student can still be checked in during/after the class.
// ---------------------------------------------------------------------------

/** Minutes before class start that QR check-in becomes available. */
export const CHECK_IN_GRACE_MINUTES = 120;

export type CheckInWindowState = "open" | "too_early" | "not_today";

/** Subtract `minutes` from an "HH:MM[:SS]" time, clamped at 00:00, returned as "HH:MM". */
function timeMinusMinutes(time: string | null, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!match) return "00:00";
  let total = Number(match[1]) * 60 + Number(match[2]) - minutes;
  if (total < 0) total = 0;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Resolve the check-in window state for a booking, given the booking's stored
 * occurrence date and its schedule's start time, evaluated in Cairo time.
 *
 *   "not_today"  — occurrence is missing or not today's Cairo date
 *   "too_early"  — today, but earlier than (startTime − grace)
 *   "open"       — within the window (startTime − grace … end of Cairo day)
 */
export function checkInWindowState(
  schedule: Pick<OccurrenceSchedule, "startTime">,
  occurrenceDate: string | null | undefined,
  now = cairoNow(),
): CheckInWindowState {
  if (!occurrenceDate || occurrenceDate !== now.date) return "not_today";
  const opensAt = timeMinusMinutes(schedule.startTime ?? null, CHECK_IN_GRACE_MINUTES);
  return now.time >= opensAt ? "open" : "too_early";
}

/** Convenience boolean: is the booking inside its check-in grace window now? */
export function isWithinCheckInWindow(
  schedule: Pick<OccurrenceSchedule, "startTime">,
  occurrenceDate: string | null | undefined,
  now = cairoNow(),
): boolean {
  return checkInWindowState(schedule, occurrenceDate, now) === "open";
}
