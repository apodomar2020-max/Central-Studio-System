import type { EligibilityResult } from "@workspace/api-zod";
import type { IsoDate, LeapDayPolicy } from "./types";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CAIRO_TIME_ZONE = "Africa/Cairo";

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseParts(value: string): DateParts | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function compareParts(left: DateParts, right: DateParts): number {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

function formatParts(parts: DateParts): IsoDate {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` as IsoDate;
}

export function getCairoBusinessDate(now = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}` as IsoDate;
}

export function parseIsoDate(
  value: string | null | undefined,
  options: { rejectFuture?: boolean; today?: IsoDate } = {},
): EligibilityResult<IsoDate> {
  if (value == null || value.trim() === "") {
    return { eligible: false, reasons: [{ code: "DOB_REQUIRED", message: "Date of birth is required." }] };
  }
  if (value !== value.trim() || !parseParts(value)) {
    return { eligible: false, reasons: [{ code: "DOB_INVALID", message: "Date of birth must be a valid date in YYYY-MM-DD format." }] };
  }
  const parsed = value as IsoDate;
  if (options.rejectFuture !== false) {
    const today = options.today ?? getCairoBusinessDate();
    if (compareParts(parseParts(parsed)!, parseParts(today)!) > 0) {
      return { eligible: false, reasons: [{ code: "DOB_FUTURE", message: "Date of birth cannot be in the future." }] };
    }
  }
  return { eligible: true, value: parsed, warnings: [] };
}

export function calculateAgeOnDate(
  dateOfBirth: IsoDate,
  evaluationDate: IsoDate,
  options: { leapDayPolicy?: LeapDayPolicy } = {},
): number {
  const dob = parseParts(dateOfBirth);
  const evaluation = parseParts(evaluationDate);
  if (!dob || !evaluation) throw new Error("calculateAgeOnDate requires valid ISO dates");
  if (compareParts(evaluation, dob) < 0) throw new Error("evaluationDate cannot be before dateOfBirth");

  let birthdayMonth = dob.month;
  let birthdayDay = dob.day;
  if (dob.month === 2 && dob.day === 29 && !isLeapYear(evaluation.year)) {
    if ((options.leapDayPolicy ?? "february_28") === "february_28") {
      birthdayDay = 28;
    } else {
      birthdayMonth = 3;
      birthdayDay = 1;
    }
  }

  const reachedBirthday =
    evaluation.month > birthdayMonth ||
    (evaluation.month === birthdayMonth && evaluation.day >= birthdayDay);
  return evaluation.year - dob.year - (reachedBirthday ? 0 : 1);
}

export function addYears(date: IsoDate, years: number, leapDayPolicy: LeapDayPolicy = "february_28"): IsoDate {
  const parts = parseParts(date);
  if (!parts || !Number.isInteger(years)) throw new Error("addYears requires a valid ISO date and integer years");
  const targetYear = parts.year + years;
  if (parts.month === 2 && parts.day === 29 && !isLeapYear(targetYear)) {
    return formatParts(leapDayPolicy === "february_28"
      ? { year: targetYear, month: 2, day: 28 }
      : { year: targetYear, month: 3, day: 1 });
  }
  return formatParts({ ...parts, year: targetYear });
}
