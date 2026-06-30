type ApiDateValue = Date | string | number | null | undefined;

function normalizeApiTimestamp(value: string): string {
  const trimmed = value.trim();
  const normalizedSeparator = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");

  return normalizedSeparator
    .replace(/\.(\d{3})\d+/, ".$1")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/\+00:00$/, "Z");
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

export function parseApiDate(value?: ApiDateValue): Date | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return isValidDate(value) ? value : null;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return isValidDate(date) ? date : null;
  }

  const raw = value.trim();
  if (!raw) return null;

  let date = new Date(raw);
  if (isValidDate(date)) return date;

  date = new Date(normalizeApiTimestamp(raw));
  if (isValidDate(date)) return date;

  const fallback = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (fallback) {
    date = new Date(Number(fallback[1]), Number(fallback[2]) - 1, Number(fallback[3]));
    if (isValidDate(date)) return date;
  }

  return null;
}

export function formatApiDate(
  value?: ApiDateValue,
  fallback = "—",
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  const date = parseApiDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString("en-GB", options);
}

export function formatApiTime(
  value?: ApiDateValue,
  fallback = "",
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  const date = parseApiDate(value);
  if (!date) return fallback;
  return date.toLocaleTimeString("en-GB", options);
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function formatRelativeOrCalendarTime(value?: ApiDateValue, fallback = "Time unavailable"): string {
  const date = parseApiDate(value);
  if (!date) return fallback;

  const timestamp = date.getTime();
  const diff = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;

  const time = date.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  const today = startOfDay(Date.now());
  const itemDay = startOfDay(timestamp);
  if (itemDay === today) return `Today, ${time}`;
  if (itemDay === today - 86_400_000) return `Yesterday, ${time}`;

  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function isApiDatePast(value?: ApiDateValue): boolean {
  const date = parseApiDate(value);
  return date ? date < new Date() : false;
}

export function isApiDateFuture(value?: ApiDateValue): boolean {
  const date = parseApiDate(value);
  return date ? date > new Date() : false;
}
