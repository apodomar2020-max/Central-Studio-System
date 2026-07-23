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

/**
 * Egypt's current UTC offset (minutes), read live from the ICU timezone
 * database for the given approximate instant — NEVER a hardcoded constant.
 * Egypt has changed its DST policy more than once (abolished 2014,
 * reintroduced an April–October "summer time" in 2023); this must keep
 * working correctly regardless of any future policy change, which is why
 * there is deliberately no "GMT+2"/"GMT+3" fallback here — if the runtime's
 * ICU data can't answer the question, we fail loudly rather than silently
 * guess a wrong offset that would corrupt attendance-window math.
 */
function cairoUtcOffsetMinutes(approxUtc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "shortOffset" }).formatToParts(approxUtc);
  const offsetText = parts.find((part) => part.type === "timeZoneName")?.value;
  const match = offsetText ? /GMT([+-]\d+)(?::(\d+))?/.exec(offsetText) : null;
  if (!match) {
    throw new Error(`Unable to determine Africa/Cairo UTC offset from ICU timezone data (got "${offsetText ?? "nothing"}") — refusing to guess a hardcoded offset.`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

/**
 * Converts a Cairo WALL-CLOCK date+time into the real UTC epoch millisecond
 * it represents. The single canonical instant-conversion used by every
 * Studio/Ballet resolver, confirmation, and Worker planning/execution path —
 * never re-derived locally, never approximated with a fixed offset.
 */
export function cairoDateTimeToUtcMs(dateOnly: string, time: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  const hours = match ? Number(match[1]) : 0;
  const minutes = match ? Number(match[2]) : 0;
  const approxUtc = new Date(`${dateOnly}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00.000Z`);
  const offsetMinutes = cairoUtcOffsetMinutes(approxUtc);
  return approxUtc.getTime() - offsetMinutes * 60_000;
}

function dayOfWeekFromIso(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** ISO calendar day-of-week (0=Sunday..6=Saturday) for a "YYYY-MM-DD" date, matching JS Date#getDay(). */
export function isoDateDayOfWeek(date: string): number {
  return dayOfWeekFromIso(date);
}

export function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addDaysToIsoDate(date: string, days: number): string {
  return addDays(date, days);
}

/**
 * Resolve the weekly occurrence that belongs in the live Attendance surface.
 * Today's occurrence remains addressable through its end boundary; tomorrow's
 * occurrence becomes addressable only once its 120-minute window has opened
 * on the previous Cairo calendar day.
 */
export function attendanceOccurrenceDateForWeeklySchedule(
  schedule: { dayOfWeek: number; startTime?: string | null; endTime?: string | null },
  now: Date = new Date(),
): string | null {
  const today = cairoNow(now).date;
  const tomorrow = addDays(today, 1);
  if (isoDateDayOfWeek(today) === schedule.dayOfWeek) return today;
  if (
    isoDateDayOfWeek(tomorrow) === schedule.dayOfWeek
    && checkInWindowState(schedule, tomorrow, now) === "open"
  ) {
    return tomorrow;
  }
  return null;
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
// Check-in / attendance eligibility window — the SINGLE canonical Cairo-time
// window shared by Studio and Ballet, at every entry point (resolver,
// confirmation, Worker planning, Worker execution).
//
// Policy: opens exactly 120 minutes before the occurrence's real start
// instant, closes exactly at the occurrence's real end instant. Computed
// entirely in real UTC-epoch-instant arithmetic (via cairoDateTimeToUtcMs)
// — NOT wall-clock string comparison — so a pre-midnight opening (e.g. a
// Tuesday 01:00 class opens Monday 23:00) is handled correctly instead of
// being clamped to 00:00.
// ---------------------------------------------------------------------------

/** Minutes before class start that check-in becomes available. */
export const CHECK_IN_GRACE_MINUTES = 120;

export type CheckInWindowState = "open" | "too_early" | "ended" | "not_today";

/** Normalize an "HH:MM[:SS]" time string to "HH:MM", or null if unparseable/absent. */
function normalizeTimeHHMM(time: string | null | undefined): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/**
 * Resolve the attendance window state for an occurrence, given its
 * occurrence date and its schedule's start/end time, evaluated against a
 * real instant (defaults to the authoritative server clock).
 *
 *   "not_today"  — occurrenceDate is missing/unparseable, or startTime is missing
 *   "too_early"  — real now is before (occurrenceStart − 120min)
 *   "ended"      — endTime is known and real now is at/after occurrenceEnd
 *   "open"       — within [occurrenceStart − 120min, occurrenceEnd)
 *
 * If the schedule's own end time is not strictly after its start time (an
 * overnight schedule, e.g. 23:00–01:00), the end instant is rolled forward
 * to the next calendar day — this is about the SCHEDULE spanning midnight,
 * distinct from (and in addition to) the opening-window pre-midnight case.
 */
export function checkInWindowState(
  schedule: Pick<OccurrenceSchedule, "startTime"> & { endTime?: string | null },
  occurrenceDate: string | null | undefined,
  now: Date = new Date(),
): CheckInWindowState {
  const startTime = normalizeTimeHHMM(schedule.startTime);
  if (!occurrenceDate || !startTime) return "not_today";

  const occurrenceStartMs = cairoDateTimeToUtcMs(occurrenceDate, startTime);
  const openMs = occurrenceStartMs - CHECK_IN_GRACE_MINUTES * 60_000;

  const endTime = normalizeTimeHHMM(schedule.endTime);
  let occurrenceEndMs: number | null = null;
  if (endTime != null) {
    occurrenceEndMs = cairoDateTimeToUtcMs(occurrenceDate, endTime);
    if (occurrenceEndMs <= occurrenceStartMs) occurrenceEndMs += 24 * 60 * 60_000;
  }

  const nowMs = now.getTime();
  if (nowMs < openMs) return "too_early";
  if (occurrenceEndMs != null && nowMs >= occurrenceEndMs) return "ended";
  return "open";
}

/** Convenience boolean: is the occurrence inside its check-in grace window right now? */
export function isWithinCheckInWindow(
  schedule: Pick<OccurrenceSchedule, "startTime"> & { endTime?: string | null },
  occurrenceDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return checkInWindowState(schedule, occurrenceDate, now) === "open";
}
