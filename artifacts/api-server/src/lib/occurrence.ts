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
