/**
 * Adapters that map the backend API shapes (from @workspace/api-client-react)
 * onto the richer mobile data model defined in ./mockData.
 *
 * Scope: Classes, instructors, and recurring schedule display. Seat counts
 * are not yet aggregated by the API and fall back to neutral defaults. Age
 * group is a real DB column (age_group) and is mapped directly from the API.
 */
import type {
  Class as ApiClass,
  Instructor as ApiInstructor,
  Schedule as ApiSchedule,
} from "@workspace/api-client-react";
import { normalizeMediaUrl } from "@workspace/api-client-react";

import { DANCE_CATEGORIES, type AgeGroup, type DanceClass, type Instructor } from "./mockData";
import {
  addDaysToDateKey,
  formatCairoDateKey,
  formatDateKeyLabel,
  getNextCairoScheduleDate,
} from "@/utils/cairoDate";


function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function coerceAgeGroup(raw: string): AgeGroup {
  switch (raw) {
    case "Kids":
    case "Teens":
    case "Adults":
      return raw;
    default:
      // Unknown value — default to Adults so existing rows are always visible
      return "Adults";
  }
}

function coerceLevel(level: string): DanceClass["level"] {
  switch (level) {
    case "Beginner":
    case "Intermediate":
    case "Advanced":
    case "All Levels":
      return level;
    default:
      // Unknown value from DB — treat as "All Levels" so nothing gets hidden
      return "All Levels";
  }
}

/**
 * Normalize a category string for fuzzy matching:
 * strips spaces, hyphens, underscores and lowercases.
 * "Hip Hop" → "hiphop", "Afro-Dance" → "afrodance", "house_dance" → "housedance"
 */
function normalizeCat(s: string): string {
  return s.trim().toLowerCase().replace(/[\s\-_]+/g, "");
}

/**
 * Find the mobile category that matches an API class's free-text category.
 * Uses fuzzy normalization so "Hiphop", "hip-hop", "Hip Hop" all resolve to c1.
 */
function findCategoryByName(category: string) {
  const needle = normalizeCat(category);
  return DANCE_CATEGORIES.find((c) => normalizeCat(c.name) === needle);
}

export function mapApiInstructorToMobile(api: ApiInstructor): Instructor {
  return {
    id: String(api.id),
    name: api.name,
    title: api.specialties.length
      ? `${api.specialties.join(" & ")} Instructor`
      : "Instructor",
    bio: api.bio ?? "",
    danceStyles: api.specialties,
    rating: api.rating ?? 0,
    // No live "classes taught" count from the API yet; experienceYears is the
    // closest available signal and keeps profile cards from showing 0.
    totalClasses: api.experienceYears,
    photoColor: "#00B6D7",
    initials: initialsFromName(api.name),
    photoUrl: normalizeMediaUrl(api.photoUrl, "image"),
  };
}

/** "18:00" → "6:00 PM", "09:30" → "9:30 AM" */
function formatTime(timeStr: string): string {
  const [hoursStr = "0", minsStr = "00"] = timeStr.split(":");
  const hours = parseInt(hoursStr, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${h}:${minsStr} ${ampm}`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type ScheduleStatus = "active" | "completed" | "expired" | "cancelled";

function coerceScheduleStatus(status: unknown): ScheduleStatus {
  switch (status) {
    case "completed":
    case "expired":
    case "cancelled":
      return status;
    default:
      return "active";
  }
}

export function isMobileVisibleSchedule(schedule?: ApiSchedule | null): boolean {
  return coerceScheduleStatus(schedule?.status) !== "expired";
}

export function isBookableScheduleStatus(status?: string | null): boolean {
  return coerceScheduleStatus(status) === "active";
}

function coerceDayOfWeek(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 6) {
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const numeric = Number(trimmed);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) return numeric;
    const normalized = trimmed.toLowerCase().slice(0, 3);
    const idx = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(normalized);
    return idx >= 0 ? idx : null;
  }
  return null;
}

function formatDateLabel(date: string): string {
  return formatDateKeyLabel(date);
}

function scheduleDateForWeek(schedule: ApiSchedule, weekStart: Date): string {
  if (schedule.type === "one_time" && schedule.date) {
    return schedule.date;
  }

  // Map dayOfWeek (0=Sun…6=Sat) to an offset from Saturday.
  const dayOfWeek = coerceDayOfWeek(schedule.dayOfWeek) ?? 0;
  const offset = (dayOfWeek - 6 + 7) % 7;
  return addDaysToDateKey(formatCairoDateKey(weekStart), offset);
}

export function getNextScheduleOccurrenceDate(schedule: ApiSchedule, fromDate = new Date()): string {
  if (schedule.type === "one_time" && schedule.date) {
    return schedule.date;
  }

  const dayOfWeek = coerceDayOfWeek(schedule.dayOfWeek) ?? 0;
  return getNextCairoScheduleDate(dayOfWeek, schedule.startTime, fromDate);
}

export function compareSchedulesByNextOccurrence(a: ApiSchedule, b: ApiSchedule, fromDate = new Date()): number {
  const aDate = getNextScheduleOccurrenceDate(a, fromDate);
  const bDate = getNextScheduleOccurrenceDate(b, fromDate);
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  return a.startTime.localeCompare(b.startTime);
}

function applySchedule(
  cls: DanceClass,
  schedule?: ApiSchedule,
  occurrenceDate?: string,
  classCapacityEnabled = true,
): DanceClass {
  if (!schedule) return cls;
  const dayOfWeek = coerceDayOfWeek(schedule.dayOfWeek);
  const startTime = formatTime(schedule.startTime);
  const endTime = formatTime(schedule.endTime);
  const isOneTime = schedule.type === "one_time";
  const dayName = isOneTime && schedule.date
    ? formatDateLabel(schedule.date)
    : dayOfWeek == null ? "" : DAY_NAMES[dayOfWeek] ?? "";
  const scheduleLabel = dayName
    ? `${dayName} • ${startTime}${endTime ? ` - ${endTime}` : ""}`
    : "Schedule not set";

  // Real BOOKINGS count for this schedule (from the backend; non-cancelled
  // bookings — NOT attendance). Drives the capacity/progress bar and a coherent
  // availability status so the bar, the "X available · Y/Z booked" text, and the
  // status chip all agree.
  const effectiveClassCapacityEnabled =
    classCapacityEnabled &&
    schedule.classCapacityEnabled !== false &&
    schedule.capacityDisplayEnabled !== false &&
    schedule.capacityEnforcementEnabled !== false;
  const bookedCount = schedule.actualBookedCount ?? schedule.reservedSeatCount ?? schedule.bookedCount ?? cls.bookedCount;
  const availableSeats = cls.capacity - bookedCount;
  const scheduleStatus = coerceScheduleStatus(schedule.status);
  const status: DanceClass["status"] =
    scheduleStatus === "cancelled" ? "cancelled"
    : scheduleStatus === "completed" ? "unavailable"
    : effectiveClassCapacityEnabled && availableSeats <= 0 ? "full"
    : effectiveClassCapacityEnabled && availableSeats <= 3 ? "fewSeats"
    : "available";

  return {
    ...cls,
    scheduleId: String(schedule.id),
    scheduleType: schedule.type,
    scheduleStatus,
    packageEligible: schedule.packageEligible ?? true,
    // Prefer the backend-computed current occurrence so item.date lines up exactly
    // with a booking's occurrenceDate (both server-computed) for Cancel-CTA matching.
    date: occurrenceDate ?? schedule.currentOccurrenceDate ?? getNextScheduleOccurrenceDate(schedule),
    dayOfWeek: dayName,
    startTime,
    endTime,
    scheduleLabel,
    location: schedule.location ?? cls.location,
    price: schedule.priceEgp ?? cls.price,
    bookedCount,
    classCapacityEnabled: effectiveClassCapacityEnabled,
    status,
  };
}

/** Display-only capacity values for the current canonical occurrence. */
export function classCapacityDisplay(
  cls: Pick<DanceClass, "status" | "capacity" | "bookedCount">,
): { booked: number; available: number; pct: number; isFull: boolean } {
  const isFull = cls.status === "full";
  const booked = isFull ? cls.capacity : cls.bookedCount;
  const available = Math.max(0, cls.capacity - booked);
  const pct = cls.capacity > 0 ? Math.round((booked / cls.capacity) * 100) : isFull ? 100 : 0;
  return { booked, available, pct, isFull };
}

export function isClassCapacityDisplayEnabled(cls: Pick<DanceClass, "classCapacityEnabled">): boolean {
  return cls.classCapacityEnabled !== false;
}

export function getScheduleLabel(cls: DanceClass): string {
  if (cls.scheduleLabel) return cls.scheduleLabel;
  if (!cls.dayOfWeek || !cls.startTime) return "Schedule not set";
  return cls.endTime
    ? `${cls.dayOfWeek} • ${cls.startTime} - ${cls.endTime}`
    : `${cls.dayOfWeek} • ${cls.startTime}`;
}

/**
 * Given a recurring schedule + its class and the Saturday that starts the
 * Egyptian work week, produce a DanceClass the home-screen can display.
 *
 * The returned `id` is the API class ID (as a string), which is what the
 * booking flow and class-detail screen expect.
 */
export function mapScheduleAndClassToMobile(
  schedule: ApiSchedule,
  cls: ApiClass,
  weekStart: Date, // the Saturday of the current Egyptian week
  singleClassPriceEgp = 0,
  classCapacityEnabled = true,
): DanceClass {
  return applySchedule(
    mapApiClassToMobile(cls, singleClassPriceEgp),
    schedule,
    scheduleDateForWeek(schedule, weekStart),
    classCapacityEnabled,
  );
}

export function mapApiClassToMobile(api: ApiClass, singleClassPriceEgp = 0): DanceClass {
  const category = findCategoryByName(api.category);

  return {
    id: String(api.id),
    scheduleId: undefined,
    // Fall back to the raw category string so the value is always defined even
    // when it doesn't match one of the known mobile categories.
    categoryId: category?.id ?? api.category,
    categoryName: api.category,
    instructorId: api.instructorId != null ? String(api.instructorId) : "",
    title: api.title,
    description: api.description ?? "",
    photoUrl: normalizeMediaUrl(api.photoUrl, "image"),
    classVideoUrl: normalizeMediaUrl(api.classVideoUrl, "video"),
    date: "",
    dayOfWeek: "",
    startTime: "",
    endTime: "",
    scheduleLabel: undefined,
    duration: `${api.durationMins} min`,
    location: "Central Studio",
    room: "",
    price: singleClassPriceEgp,
    capacity: api.capacity,
    bookedCount: 0,
    classCapacityEnabled: true,
    level: coerceLevel(api.level),
    ageGroup: coerceAgeGroup(api.ageGroup),
    ageRangeLabel: api.ageRangeLabel,
    catalogueEligibility: api.catalogueEligibility,
    status: "available",
    policy: "",
    featured: false,
    isBallet: category?.isBallet ?? false,
    packageEligible: true,
  };
}

export function mapApiClassWithScheduleToMobile(
  api: ApiClass,
  schedule: ApiSchedule | undefined,
  singleClassPriceEgp = 0,
  classCapacityEnabled = true,
): DanceClass {
  const cls = mapApiClassToMobile(api, singleClassPriceEgp);
  cls.classCapacityEnabled = classCapacityEnabled;
  return applySchedule(cls, schedule, undefined, classCapacityEnabled);
}
