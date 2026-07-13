/**
 * services/balletAssessmentService.ts
 *
 * ─── What lives here and why ──────────────────────────────────────────────────
 *
 * STATIC CONFIG  (defined in code — these are programme definitions)
 *   BALLET_LEVELS   — the level progression offered by the studio.
 *                     Changes only when the studio restructures its curriculum.
 *   BALLET_PRICING  — offline fallback pricing for display while settings load.
 *                     The live source of truth is GET /api/ballet/settings.
 *
 * DYNAMIC DATA  (always fetched from the backend)
 *   fetchBalletSettings()   — admin-managed pricing + assessment instructions.
 *   fetchAssessmentSlots()  — real-time slot availability with live capacity.
 *
 * ─── Production rule ──────────────────────────────────────────────────────────
 *
 * Both fetch functions NEVER fall back to static/mock data.
 * If the endpoint is not available the screen renders an appropriate state
 * (offline, error) — never phantom pricing or phantom slots.
 *
 * The static BALLET_PRICING constants below are emergency offline fallback
 * values rendered in the UI only when the settings fetch is in-flight or
 * has errored. They must never be used as authoritative pricing.
 */

import { customFetch } from "@workspace/api-client-react";
import { isOfflineError } from "@/services/connectivity";

// ─── Static programme config ──────────────────────────────────────────────────

/** Ballet level progression. Update when the studio restructures its curriculum. */
export const BALLET_LEVELS: string[] = [
  "Pre-Ballet",
  "Ballet Level 1",
  "Ballet Level 2",
  "Ballet Level 3",
  "Ballet Level 4",
  "Ballet Level 5",
  "Ballet Level 6",
  "Ballet Level 7",
  "Ballet Level 8",
  "Ballet Level 9",
];

/**
 * Emergency offline fallback pricing.
 *
 * These values are used ONLY when the settings endpoint has not yet responded
 * (e.g. during initial load or when the device is offline). The screen should
 * replace them as soon as fetchBalletSettings() resolves.
 *
 * DO NOT treat these as authoritative. The admin can change pricing at any
 * time via the dashboard, and the server is always the source of truth.
 */
export const BALLET_PRICING: { level: string; hours: string; price: number }[] =
  [
    { level: "Pre-Ballet", hours: "8 hours monthly", price: 1_950 },
    { level: "Levels 1–9", hours: "12 hours monthly", price: 2_650 },
  ];

// ─── Response types ────────────────────────────────────────────────────────────

/**
 * Shape returned by GET /api/ballet/settings.
 * Reflects admin-managed config from the ballet_settings table (id = 1).
 */
export interface BalletSettings {
  preBallet: {
    monthlyHours: number;
    priceEgp: number;
  };
  levels19: {
    monthlyHours: number;
    priceEgp: number;
  };
  assessmentInstructions: string | null;
  requirements: string | null;
  acceptanceMessageTemplate: string | null;
  fewSeatsThreshold: number;
}

/**
 * Shape of a single assessment appointment slot.
 * Must match the shape returned by GET /api/ballet/assessment-slots.
 */
export interface AssessmentSlot {
  id: string;
  date: string;            // ISO date, e.g. "2026-07-05"
  dayOfWeek: string;       // "Saturday"
  startTime: string;       // "10:00 AM"
  endTime: string;         // "10:30 AM"
  capacity: number;
  bookedCount: number;
  availableSeats: number;
  status: "available" | "fewSeats" | "full";
}

// ─── Fetch functions ───────────────────────────────────────────────────────────

/**
 * Fetches admin-managed ballet settings from the backend.
 *
 * Returns pricing, session hours, assessment instructions, and the
 * fewSeatsThreshold used to colour-code slot availability.
 *
 * Throws on network failure (TypeError) or server error (Error).
 * The calling screen is responsible for catching and rendering the
 * appropriate state (isOfflineError check for offline vs server error).
 */
export async function fetchBalletSettings(
  signal?: AbortSignal
): Promise<BalletSettings> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<BalletSettings>(
    `${apiUrl}/api/ballet/settings`,
    { method: "GET", signal }
  );
  return res;
}

/**
 * Fetches live assessment slot availability from the backend.
 *
 * Returns only future, active slots ordered by date asc then startTime asc.
 * bookedCount and availableSeats are computed server-side at query time —
 * they are always accurate and never cached on the server.
 *
 * When `childAge` is provided, only slots whose age range covers that age
 * are returned (server-side filter, supported since Phase 1 — a slot with
 * no age range set is open to all ages).
 *
 * No student JWT required — slot availability is public programme info.
 * The shared API key (set in EXPO_PUBLIC_API_KEY) is sufficient.
 *
 * Throws on any failure — the calling screen catches and renders the
 * appropriate state (use isOfflineError() to distinguish offline vs error).
 */
export async function fetchAssessmentSlots(
  signal?: AbortSignal,
  childAge?: number,
): Promise<AssessmentSlot[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const query = childAge != null ? `?childAge=${encodeURIComponent(childAge)}` : "";
  const res = await customFetch<AssessmentSlot[]>(
    `${apiUrl}/api/ballet/assessment-slots${query}`,
    { method: "GET", signal }
  );
  return res;
}

// ─── Application submission ───────────────────────────────────────────────────

/**
 * Payload for POST /api/ballet/applications.
 * All fields map directly to the request body. parentStudentId is injected
 * server-side from the student JWT — never sent by the client.
 */
export interface SubmitApplicationPayload {
  parentName:             string;
  parentPhone:            string;
  parentEmail:            string;
  childName:              string;
  childBirthday?:         string;
  childAge?:              number;
  childGender?:           "male" | "female";
  emergencyContactName?:  string;
  emergencyContactPhone?: string;
  previousExperience:     boolean;
  experienceDetails?:     string;
  medicalNotes?:          string;
  notes?:                 string;
  slotId:                 number;
  /** Optional link to a saved child profile (children.id). Omitted for manual
   *  entry / logged-out users. The backend verifies it belongs to the parent. */
  childId?:               number;
}

/** Shape of the 201 response from POST /api/ballet/applications. */
export interface SubmitApplicationResult {
  application: {
    id:     number;
    status: string;
  };
}

/**
 * Submits a ballet assessment application to the backend.
 *
 * Requires a valid student JWT (set by setAuthTokenGetter in _layout.tsx).
 * The server rejects the request (401) if no JWT is present.
 *
 * Throws:
 *   - TypeError        → device offline / network unreachable
 *   - ApiError (409)   → slot is full
 *   - ApiError (404)   → slot not found or inactive
 *   - ApiError (400)   → validation failed
 *   - ApiError (401)   → not logged in
 *   - Error (other)    → server error
 *
 * The calling screen is responsible for catching and mapping to UI states.
 */
export async function submitBalletApplication(
  payload: SubmitApplicationPayload,
  signal?: AbortSignal
): Promise<SubmitApplicationResult> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  return customFetch<SubmitApplicationResult>(
    `${apiUrl}/api/ballet/applications`,
    {
      method: "POST",
      body:   JSON.stringify(payload),
      signal,
    }
  );
}

// ─── My Applications ─────────────────────────────────────────────────────────

/**
 * One resolved class time for an active, grouped student (A4). dayOfWeek is
 * 0=Sunday … 6=Saturday, matching ballet_schedules.day_of_week.
 */
export interface ResolvedBalletSchedule {
  dayOfWeek: number;
  startTime: string; // "16:00"
  endTime: string;   // "17:00"
}

/**
 * Full representation of a ballet application as returned by
 * GET /api/ballet/applications/my.
 * Includes all editable fields so the edit form can pre-fill them.
 */
export interface BalletApplication {
  id: number;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  childName: string;
  childBirthday: string | null;
  childAge: number | null;
  childGender: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  previousExperience: boolean;
  experienceDetails: string | null;
  medicalNotes: string | null;
  notes: string | null;
  slotId: number | null;
  slotLabel: string | null;
  status: string;
  adminNotes: string | null;
  assignedLevelId: number | null;
  /** groupId on the application's current active ballet_level_assignments
   *  row (Phase 4E), or null if a level is assigned but no group yet. */
  assignedGroupId: number | null;
  /** A4: real class time(s) resolved from the assigned group's schedules.
   *  Populated only when status === "active" AND a group is assigned;
   *  null otherwise (client keeps its placeholder rendering). May be an
   *  empty array if the group has no active schedule slots yet. */
  resolvedSchedules: ResolvedBalletSchedule[] | null;
  /** A4: instructor name(s) resolved from the assigned group's class(es).
   *  Same population rule as resolvedSchedules. */
  resolvedInstructors: string[] | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetches all ballet applications belonging to the authenticated parent.
 * Requires a valid student JWT.
 *
 * The server returns applications newest-first. The first item is the most
 * recent application and is typically what the mobile app needs to show.
 *
 * Throws on network failure (TypeError) or server error.
 */
export async function fetchMyApplications(
  signal?: AbortSignal
): Promise<BalletApplication[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<{ applications: BalletApplication[] }>(
    `${apiUrl}/api/ballet/applications/my`,
    { method: "GET", signal }
  );
  return res.applications;
}

/**
 * Cancels an open application.
 * Only valid while status is pending / needsFollowUp.
 * After cancellation the parent is free to submit a new application.
 */
export async function cancelBalletApplication(
  applicationId: number,
  signal?: AbortSignal
): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  await customFetch<{ success: boolean }>(
    `${apiUrl}/api/ballet/applications/${applicationId}/cancel`,
    { method: "POST", signal }
  );
}

// ─── Update application ───────────────────────────────────────────────────────

/**
 * Editable fields the parent can change while the application is in an editable
 * status (pending, needsFollowUp).
 */
export interface UpdateApplicationPayload {
  parentPhone?:           string;
  parentEmail?:           string;
  emergencyContactName?:  string;
  emergencyContactPhone?: string;
  medicalNotes?:          string;
  notes?:                 string;
  experienceDetails?:     string;
  previousExperience?:    boolean;
  slotId?:                number;
}

/**
 * PATCHes editable fields on an existing application.
 * Only valid while status is pending / needsFollowUp.
 * The server inserts an event row: note = "Application updated by parent".
 */
export async function updateBalletApplication(
  applicationId: number,
  payload: UpdateApplicationPayload,
  signal?: AbortSignal
): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  await customFetch<{ success: boolean }>(
    `${apiUrl}/api/ballet/applications/${applicationId}`,
    {
      method: "PATCH",
      body:   JSON.stringify(payload),
      signal,
    }
  );
}

// ─── Status sets ─────────────────────────────────────────────────────────────

// Statuses that mean the parent has an active open application.
export const ACTIVE_APPLICATION_STATUSES = new Set([
  "pending",
  "accepted",
  "needsFollowUp",
  "assignedToLevel",
  "active",
]);

// Statuses where Cancel is available.
export const CANCELLABLE_APPLICATION_STATUSES = new Set([
  "pending",
  "needsFollowUp",
]);

// Statuses where Edit is available.
export const EDITABLE_APPLICATION_STATUSES = new Set([
  "pending",
  "needsFollowUp",
]);

// ─── Public catalogue reads ───────────────────────────────────────────────────
//
// Phase 4a added 5 public, read-only GET /api/ballet/* endpoints exposing the
// Ballet catalogue (instructors, classes, levels, performances, groups) that
// previously only existed behind /api/admin/ballet/*. These mirror the
// fetchBalletSettings/fetchAssessmentSlots pattern above: no auth beyond the
// shared API key, never fall back to mock/static data, throw on failure so
// the calling screen can render its own loading/error/empty state.

/** Shape of a single row from GET /api/ballet/instructors. */
export interface BalletInstructor {
  id: number;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  specialties: string[];
  experienceYears: number;
  rating: number | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  teachingLevel: string | null;
  achievements: string[];
  teachingPhilosophy: string | null;
  professionalExperience: string[];
}

export async function fetchBalletInstructors(signal?: AbortSignal): Promise<BalletInstructor[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<{ instructors: BalletInstructor[] }>(
    `${apiUrl}/api/ballet/instructors`,
    { method: "GET", signal }
  );
  return res.instructors;
}

/** One weekly time slot for a ballet class, as nested in GET /api/ballet/classes. */
export interface BalletClassSchedule {
  id: number;
  dayOfWeek: number; // 0=Sunday … 6=Saturday
  startTime: string; // "16:00"
  endTime: string;   // "17:00"
  durationMins: number | null;
}

/** Shape of a single row from GET /api/ballet/classes. */
export interface BalletClass {
  id: number;
  title: string;
  classImageUrl: string | null;
  classVideoUrl: string | null;
  instructor: { id: number; name: string; photoUrl: string | null } | null;
  groupIds: number[];
  levelIds: number[];
  schedules: BalletClassSchedule[];
}

export async function fetchBalletClasses(signal?: AbortSignal): Promise<BalletClass[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<{ classes: BalletClass[] }>(
    `${apiUrl}/api/ballet/classes`,
    { method: "GET", signal }
  );
  return res.classes;
}

/** Shape of a single row from GET /api/ballet/levels. */
export interface BalletLevel {
  id: number;
  name: string;
  sortOrder: number;
  description: string | null;
  requirements: string | null;
  ageMin: number | null;
  ageMax: number | null;
}

export async function fetchBalletLevels(signal?: AbortSignal): Promise<BalletLevel[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<{ levels: BalletLevel[] }>(
    `${apiUrl}/api/ballet/levels`,
    { method: "GET", signal }
  );
  return res.levels;
}

/** Shape of a single row from GET /api/ballet/performances. */
export interface BalletPerformance {
  id: number;
  eventTitle: string;
  eventType: string;
  locationName: string | null;
  eventDate: string; // ISO date, e.g. "2026-12-20"
  startTime: string;
  endTime: string;
  requirements: string[];
}

export async function fetchBalletPerformances(signal?: AbortSignal): Promise<BalletPerformance[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<{ performances: BalletPerformance[] }>(
    `${apiUrl}/api/ballet/performances`,
    { method: "GET", signal }
  );
  return res.performances;
}

/** Shape of a single row from GET /api/ballet/groups. */
export interface BalletGroup {
  id: number;
  name: string;
  levelId: number;
}

export async function fetchBalletGroups(signal?: AbortSignal): Promise<BalletGroup[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<{ groups: BalletGroup[] }>(
    `${apiUrl}/api/ballet/groups`,
    { method: "GET", signal }
  );
  return res.groups;
}

// Re-export so callers can check offline status without importing connectivity separately.
export { isOfflineError };
