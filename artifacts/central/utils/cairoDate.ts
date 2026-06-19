const CAIRO_TIME_ZONE = "Africa/Cairo";

const cairoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAIRO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const cairoTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: CAIRO_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const displayDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});

function partsFromFormatter(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

export function formatCairoDateKey(date = new Date()): string {
  const parts = partsFromFormatter(cairoDateFormatter, date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCairoTomorrowDateKey(date = new Date()): string {
  return addDaysToDateKey(formatCairoDateKey(date), 1);
}

export function getCairoDayOfWeek(date = new Date()): number {
  const dateKey = formatCairoDateKey(date);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return date.getDay();
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

export function getCairoMinutesSinceMidnight(date = new Date()): number {
  const parts = partsFromFormatter(cairoTimeFormatter, date);
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  return hour * 60 + Number(parts.minute ?? 0);
}

export function getNextCairoScheduleDate(
  dayOfWeek: number,
  startTime: string,
  fromDate = new Date(),
): string {
  const todayKey = formatCairoDateKey(fromDate);
  const todayDow = getCairoDayOfWeek(fromDate);
  let daysUntil = (dayOfWeek - todayDow + 7) % 7;
  if (daysUntil === 0 && minutesFromTime(startTime) <= getCairoMinutesSinceMidnight(fromDate)) {
    daysUntil = 7;
  }
  return addDaysToDateKey(todayKey, daysUntil);
}

export function formatDateKeyLabel(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return displayDateFormatter.format(date);
}

function minutesFromTime(timeStr: string): number {
  const [hoursStr = "0", minsStr = "00"] = timeStr.split(":");
  return Number(hoursStr) * 60 + Number(minsStr);
}
