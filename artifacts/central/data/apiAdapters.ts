/**
 * Adapters that map the backend API shapes (from @workspace/api-client-react)
 * onto the richer mobile data model defined in ./mockData.
 *
 * Scope: Classes and Instructors only. The backend does not (yet) expose
 * scheduling, pricing, seat counts, or age groups for a class, so those
 * fields are filled with safe neutral defaults until those endpoints are
 * wired up. Booking-related fields are intentionally left untouched.
 */
import type {
  Class as ApiClass,
  Instructor as ApiInstructor,
} from "@workspace/api-client-react";

import { DANCE_CATEGORIES, type AgeGroup, type DanceClass, type Instructor } from "./mockData";

// Deterministic avatar palette so an instructor always renders the same colour.
const AVATAR_COLORS = [
  "#FF6B35",
  "#EF4444",
  "#A78BFA",
  "#EC4899",
  "#22C55E",
  "#06B6D4",
  "#F59E0B",
  "#3B82F6",
];

function colorForId(id: number): string {
  return AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length];
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function coerceLevel(level: string): DanceClass["level"] {
  switch (level) {
    case "Beginner":
    case "Intermediate":
    case "Advanced":
      return level;
    default:
      return "Beginner";
  }
}

/** Find the mobile category that matches an API class's free-text category. */
function findCategoryByName(category: string) {
  const needle = category.trim().toLowerCase();
  return DANCE_CATEGORIES.find((c) => c.name.toLowerCase() === needle);
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
    photoColor: colorForId(api.id),
    initials: initialsFromName(api.name),
    photoUrl: api.photoUrl ?? undefined,
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
    ageGroup: "Adults" as AgeGroup,
    status: "available",
    policy: "",
    featured: false,
    isBallet: category?.isBallet ?? false,
  };
}
