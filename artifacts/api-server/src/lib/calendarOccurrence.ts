/**
 * Read-only projection of `schedules`/`ballet_schedules` rows into concrete
 * calendar occurrence dates over a range. This is NOT a new recurrence
 * system — it reuses the exact day-matching rule routes/dashboard.ts's
 * `occursOn` already uses for the "upcoming classes" widget (weekly +
 * dayOfWeek, respecting effectiveFrom/effectiveUntil; one_time + date),
 * generalized from "does this occur on day X" to "list every date it occurs
 * on in [from, to]". Built on top of the existing Cairo-date primitives in
 * ./occurrence.ts rather than reimplementing date math.
 */
import { addDaysToIsoDate, isoDateDayOfWeek, isValidIsoDate } from "./occurrence";

export interface ProjectableSchedule {
  type: "weekly" | "one_time";
  date?: string | null;
  dayOfWeek?: number | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
}

/** Bounds how large a single calendar request can be — a generous multiple
 *  of the week view Phase 1 actually renders, without allowing an unbounded
 *  range scan. */
export const MAX_CALENDAR_RANGE_DAYS = 62;

export class InvalidCalendarRangeError extends Error {}

/** Inclusive list of "YYYY-MM-DD" dates from `from` to `to`. */
export function isoDateRange(from: string, to: string): string[] {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new InvalidCalendarRangeError("from/to must be valid YYYY-MM-DD dates.");
  }
  if (from > to) {
    throw new InvalidCalendarRangeError("from must not be after to.");
  }
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    if (dates.length >= MAX_CALENDAR_RANGE_DAYS) {
      throw new InvalidCalendarRangeError(`Date range cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days.`);
    }
    dates.push(cursor);
    cursor = addDaysToIsoDate(cursor, 1);
  }
  return dates;
}

/** Same rule as routes/dashboard.ts's occursOn, generalized to any date. */
export function scheduleOccursOnDate(schedule: ProjectableSchedule, dateKey: string): boolean {
  if (schedule.type === "one_time") return schedule.date === dateKey;
  if (schedule.dayOfWeek == null || isoDateDayOfWeek(dateKey) !== schedule.dayOfWeek) return false;
  if (schedule.effectiveFrom && schedule.effectiveFrom > dateKey) return false;
  if (schedule.effectiveUntil && schedule.effectiveUntil < dateKey) return false;
  return true;
}

/** Every concrete date a schedule occurs on within [from, to]. */
export function projectOccurrenceDates(schedule: ProjectableSchedule, from: string, to: string): string[] {
  return isoDateRange(from, to).filter((date) => scheduleOccursOnDate(schedule, date));
}
