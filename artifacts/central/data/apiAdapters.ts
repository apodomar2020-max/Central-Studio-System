/**
 * Adapters that map the backend API shapes (from @workspace/api-client-react)
 * onto the richer mobile data model defined in ./mockData.
 *
 * Scope: Classes and Instructors only. Scheduling, pricing, and seat counts
 * are not yet exposed by the API and fall back to neutral defaults. Age group
 * is now a real DB column (age_group) and is mapped directly from the API.
 */
import type {
  Class as ApiClass,
  Instructor as ApiInstructor,
  Schedule as ApiSchedule,
} from "@workspace/api-client-react";

import { DANCE_CATEGORIES, type AgeGroup, type DanceClass, type Instructor } from "./mockData";


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
    photoUrl: api.photoUrl ?? undefined,
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
): DanceClass {
  // Map dayOfWeek (0=Sun…6=Sat) to an offset from Saturday
  // Sat=0, Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=6
  const offset = (schedule.dayOfWeek - 6 + 7) % 7;
  const dateObj = new Date(weekStart);
  dateObj.setDate(weekStart.getDate() + offset);
  const dateStr = dateObj.toISOString().slice(0, 10);

  const category = findCategoryByName(cls.category);

  return {
    id: String(cls.id),
    categoryId: category?.id ?? cls.category,
    categoryName: cls.category,
    instructorId: cls.instructorId != null ? String(cls.instructorId) : "",
    title: cls.title,
    description: cls.description ?? "",
    date: dateStr,
    dayOfWeek: DAY_NAMES[schedule.dayOfWeek] ?? "",
    startTime: formatTime(schedule.startTime),
    endTime: formatTime(schedule.endTime),
    duration: `${cls.durationMins} min`,
    location: schedule.location ?? "Central Studio, Zamalek",
    room: "",
    price: 0, // price not exposed on the schedules API yet
    capacity: cls.capacity,
    bookedCount: 0, // booking counts not aggregated on the API yet
    level: coerceLevel(cls.level),
    ageGroup: coerceAgeGroup(cls.ageGroup),
    status: "available" as const,
    policy: "",
    featured: false,
    isBallet: category?.isBallet ?? false,
  };
}

export function mapApiClassToMobile(api: ApiClass): DanceClass {
  const category = findCategoryByName(api.category);

  return {
    id: String(api.id),
    // Fall back to the raw category string so the value is always defined even
    // when it doesn't match one of the known mobile categories.
    categoryId: category?.id ?? api.category,
    categoryName: api.category,
    instructorId: api.instructorId != null ? String(api.instructorId) : "",
    title: api.title,
    description: api.description ?? "",
    // Scheduling/pricing come from endpoints that are not wired up yet.
    date: "",
    dayOfWeek: "",
    startTime: "",
    endTime: "",
    duration: `${api.durationMins} min`,
    location: "Central Studio, Zamalek",
    room: "",
    price: 0,
    capacity: api.capacity,
    bookedCount: 0,
    level: coerceLevel(api.level),
    ageGroup: coerceAgeGroup(api.ageGroup),
    status: "available",
    policy: "",
    featured: false,
    isBallet: category?.isBallet ?? false,
  };
}
