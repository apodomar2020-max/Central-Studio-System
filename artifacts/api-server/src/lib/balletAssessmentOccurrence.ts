import { addDaysToIsoDate, cairoDateTimeToUtcMs } from "./occurrence";

const TIME_PATTERN = /^(\d{1,2}):(\d{2})/;

function minutesSinceMidnight(time: string): number | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Returns whether an assessment occurrence has ended at the authoritative
 * server instant. Schedule date/time values are Cairo wall-clock values.
 * Overnight schedules roll their end onto the following Cairo calendar day.
 */
export function hasAssessmentOccurrenceEnded(
  occurrenceDate: string,
  startTime: string,
  endTime: string,
  now: Date = new Date(),
): boolean {
  const startMinutes = minutesSinceMidnight(startTime);
  const endMinutes = minutesSinceMidnight(endTime);
  if (startMinutes == null || endMinutes == null) return true;

  const endDate = endMinutes <= startMinutes
    ? addDaysToIsoDate(occurrenceDate, 1)
    : occurrenceDate;
  const endUtcMs = cairoDateTimeToUtcMs(endDate, endTime);
  return endUtcMs <= now.getTime();
}

export function assertAssessmentOccurrenceNotExpired(
  occurrenceDate: string,
  startTime: string,
  endTime: string,
  now: Date = new Date(),
): void {
  if (!hasAssessmentOccurrenceEnded(occurrenceDate, startTime, endTime, now)) return;

  throw Object.assign(
    new Error("The selected assessment appointment has expired. Please choose another appointment."),
    { status: 422 as const, code: "ASSESSMENT_SLOT_EXPIRED" as const },
  );
}
