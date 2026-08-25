/**
 * Wave 3 (F-20): mirrors the server's 2-hour self-cancellation cutoff
 * (api-server/src/lib/bookingCancellationEligibility.ts) so the UI can
 * hide/disable a Cancel action that the server would reject anyway — this
 * is a UX mirror only, never the authority. The server re-checks this exact
 * same window on every PATCH /bookings/:id/cancel; a race or clock-skew
 * boundary case is always resolved by the server's own answer, never by
 * what this file computed.
 *
 * Uses the same real-instant conversion approach as the server's
 * cairoDateTimeToUtcMs (Cairo wall-clock -> true UTC epoch ms via live ICU
 * offset data, never a hardcoded GMT+2/+3 constant) so a cross-midnight
 * class resolves correctly here too.
 */
const CAIRO_TIME_ZONE = "Africa/Cairo";

/** Minutes before class start that self-cancellation remains allowed — must match the server constant exactly. */
export const SELF_CANCEL_CUTOFF_MINUTES = 120;

function cairoUtcOffsetMinutes(approxUtc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: CAIRO_TIME_ZONE, timeZoneName: "shortOffset" }).formatToParts(approxUtc);
  const offsetText = parts.find((part) => part.type === "timeZoneName")?.value;
  const match = offsetText ? /GMT([+-]\d+)(?::(\d+))?/.exec(offsetText) : null;
  if (!match) return 120; // defensive fallback only if the runtime's ICU data is unavailable — never blocks the UI from rendering
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

function cairoDateTimeToUtcMs(dateOnly: string, time: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  const hours = match ? Number(match[1]) : 0;
  const minutes = match ? Number(match[2]) : 0;
  const approxUtc = new Date(`${dateOnly}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00.000Z`);
  const offsetMinutes = cairoUtcOffsetMinutes(approxUtc);
  return approxUtc.getTime() - offsetMinutes * 60_000;
}

/** Resolves the booking occurrence to a real instant for read-only UI such as
 * countdowns. It deliberately shares the cancellation window's Cairo/DST
 * conversion so the two surfaces can never disagree about class start time. */
export function bookingOccurrenceStartMs(
  params: { occurrenceDate: string | null | undefined; startTime: string | null | undefined },
): number | null {
  if (!params.occurrenceDate || !params.startTime) return null;
  return cairoDateTimeToUtcMs(params.occurrenceDate, params.startTime);
}

/**
 * Mirrors the server's isBookingSelfCancellable exactly: eligible only when
 * time-until-class-start >= 2 hours. Missing occurrenceDate/startTime is
 * NOT eligible (never silently permissive) — matches the server's
 * "occurrence_unresolvable" behavior.
 */
export function isBookingSelfCancellableClientSide(
  params: { occurrenceDate: string | null | undefined; startTime: string | null | undefined },
  now: Date = new Date(),
): boolean {
  if (!params.occurrenceDate || !params.startTime) return false;
  const occurrenceStartMs = bookingOccurrenceStartMs(params);
  if (occurrenceStartMs == null) return false;
  const cutoffMs = occurrenceStartMs - SELF_CANCEL_CUTOFF_MINUTES * 60_000;
  return now.getTime() <= cutoffMs;
}
