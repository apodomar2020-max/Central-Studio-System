/**
 * services/balletAssessmentService.ts
 *
 * ─── What lives here and why ──────────────────────────────────────────────────
 *
 * STATIC CONFIG  (defined in code — these are programme definitions)
 *   BALLET_LEVELS   — the level progression offered by the studio.
 *                     Changes only when the studio restructures its curriculum.
 *
 * DYNAMIC DATA  (always fetched from the backend)
 *   fetchBalletSettings()   — admin-managed mobile presentation settings.
 *   fetchAvailableAssessmentSchedules() — schedule-based assessment availability.
 *
 * ─── Production rule ──────────────────────────────────────────────────────────
 *
 * Both fetch functions NEVER fall back to static/mock data.
 * If the endpoint is not available the screen renders an appropriate state
 * (offline, error) — never phantom pricing or phantom slots.
 *
 */

import { customFetch } from "@workspace/api-client-react";
import type { BalletPaymentMethod } from "@workspace/api-zod";
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

// ─── Response types ────────────────────────────────────────────────────────────

/**
 * Shape returned by GET /api/ballet/settings.
 * Reflects admin-managed mobile presentation config from the ballet_settings
 * table (id = 1).
 */
export interface BalletSettings {
  homeCardImageUrl: string | null;
  whatsappNumber: string | null;
  phoneNumber: string | null;
  email: string | null;
  studioLocationUrl: string | null;
}

/**
 * Public aggregate counts returned by GET /api/ballet/summary.
 * These are programme-level numbers only; no personal application/student data.
 */
export interface BalletSummary {
  activeStudents: number;
  instructors: number;
  levels: number;
  classes: number;
}

export interface BalletProgramRequirementItem {
  id: number;
  sectionId: number;
  text: string;
  sortOrder: number;
}

export interface BalletProgramRequirementSection {
  id: number;
  title: string;
  description: string | null;
  sortOrder: number;
  items: BalletProgramRequirementItem[];
}

export interface BalletFaq {
  id: number;
  question: string;
  answer: string;
  sortOrder: number;
}

/**
 * Shape of one projected assessment schedule occurrence.
 * Must match GET /api/ballet/available-assessment-schedules.
 */
export interface AssessmentScheduleOption {
  scheduleId: number;
  classId: number;
  className: string;
  levelId: number;
  levelName: string;
  date: string;
  day: string;
  time: string;
  startTime: string;
  endTime: string;
}

export interface BalletPackageOption {
  id: number;
  name: string;
  monthlyClasses: number;
  monthlyHours: number;
  priceEgp: number;
  levelIds: number[];
}

// ─── Fetch functions ───────────────────────────────────────────────────────────

/**
 * Fetches admin-managed ballet mobile presentation settings from the backend.
 *
 * Throws on network failure (TypeError) or server error (Error).
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

export async function fetchBalletSummary(
  signal?: AbortSignal
): Promise<BalletSummary> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  return customFetch<BalletSummary>(
    `${apiUrl}/api/ballet/summary`,
    { method: "GET", signal }
  );
}

export async function fetchBalletProgramRequirements(signal?: AbortSignal): Promise<BalletProgramRequirementSection[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<{ sections: BalletProgramRequirementSection[] }>(
    `${apiUrl}/api/ballet/program-requirements`,
    { method: "GET", signal }
  );
  return res.sections;
}

export async function fetchBalletFaqs(signal?: AbortSignal): Promise<BalletFaq[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<{ faqs: BalletFaq[] }>(
    `${apiUrl}/api/ballet/faqs`,
    { method: "GET", signal }
  );
  return res.faqs;
}

/**
 * Fetches live assessment schedule occurrences from the backend.
 *
 * Returns projected occurrences for the next 4 weeks based on active Ballet
 * levels, classes, and class schedules. Age filtering is derived server-side
 * from the child's birthday.
 *
 * No student JWT required — slot availability is public programme info.
 * The shared API key (set in EXPO_PUBLIC_API_KEY) is sufficient.
 *
 * Throws on any failure — the calling screen catches and renders the
 * appropriate state (use isOfflineError() to distinguish offline vs error).
 */
export async function fetchAvailableAssessmentSchedules(
  signal?: AbortSignal,
  childBirthday?: string,
): Promise<AssessmentScheduleOption[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const query = childBirthday ? `?childBirthday=${encodeURIComponent(childBirthday)}` : "";
  const res = await customFetch<AssessmentScheduleOption[]>(
    `${apiUrl}/api/ballet/available-assessment-schedules${query}`,
    { method: "GET", signal }
  );
  return res;
}

export async function fetchBalletPackages(
  signal?: AbortSignal,
): Promise<BalletPackageOption[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<{ packages: BalletPackageOption[] }>(
    `${apiUrl}/api/ballet/packages`,
    { method: "GET", signal }
  );
  return res.packages;
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
  assessmentScheduleId:   number;
  assessmentDate:         string;
  /** C1: parent's chosen payment method at intake — required by the backend.
   *  A preference only; the backend never creates a payment from it. */
  preferredPaymentMethod: BalletPaymentMethod;
  preferredPackageId?:    number;
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
 *   - ApiError (422)   → schedule unavailable or age-ineligible
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
 * C4: current-month attendance-hours summary for an active, subscribed student.
 * Present on an application only when there IS an active monthly subscription
 * for the current calendar month; null otherwise (same null-when-not-applicable
 * convention as resolvedSchedules/resolvedInstructors). When present,
 * hasActiveSubscription is always true and monthly/remaining are non-null.
 */
export interface BalletAttendanceSummary {
  billingMonth: string;        // "YYYY-MM"
  hasActiveSubscription: boolean;
  attendedHours: number;
  absentHours: number;
  consumedHours: number;
  monthlyHours: number | null;
  remainingHours: number | null;
}

/**
 * Full representation of a ballet application as returned by
 * GET /api/ballet/applications/my.
 * Includes all editable fields so the edit form can pre-fill them.
 */
export interface BalletApplication {
  id: number;
  childId: number | null;
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
  assessmentScheduleId: number | null;
  assessmentDate: string | null;
  preferredPackageId: number | null;
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
  /** C4: current-month hours summary, or null when there's no active monthly
   *  subscription for the current month (or no active assignment). */
  attendanceSummary: BalletAttendanceSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface BalletLevelAssignmentSummary {
  id: number;
  applicationId: number;
  childId: number | null;
  levelId: number;
  groupId: number | null;
  status: string;
}

export interface BalletCancellationRequest {
  id: number;
  applicationId: number | null;
  levelAssignmentId: number | null;
  status: string;
  requestedTiming: string;
  approvedTiming: string | null;
  requestedEffectiveDate: string | null;
  approvedEffectiveDate: string | null;
  reason: string;
  requestRefund: boolean;
  initiatedByType?: "parent" | "admin";
  initiatedByAdminId?: number | null;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BalletRefundSummary {
  id: number;
  cancellationRequestId: number | null;
  paymentId: number;
  status: string;
  refundMethod: string;
  approvedAmountEgp: number | null;
  refundedAmountEgp: number | null;
  transactionReference: string | null;
  requestedReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface BalletApplicationDetail {
  application: BalletApplication;
  activeAssignment: BalletLevelAssignmentSummary | null;
  openCancellationRequest: BalletCancellationRequest | null;
  currentPayment: {
    id: number;
    amountEgp: number;
    status: string;
    paymentMethod: string | null;
    paidAt: string | null;
  } | null;
  refunds: BalletRefundSummary[];
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

export async function fetchBalletApplicationDetail(
  applicationId: number,
  signal?: AbortSignal
): Promise<BalletApplicationDetail> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  return customFetch<BalletApplicationDetail>(
    `${apiUrl}/api/ballet/applications/${applicationId}`,
    { method: "GET", signal }
  );
}

/**
 * Cancels an open application.
 * Only valid while status is pending / needsFollowUp.
 * After cancellation the parent is free to submit a new application.
 */
export async function cancelBalletApplication(
  applicationId: number,
  options?: { requestRefund?: boolean; reason?: string },
  signal?: AbortSignal
): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  await customFetch<{ success: boolean }>(
    `${apiUrl}/api/ballet/applications/${applicationId}/cancel`,
    { method: "POST", body: JSON.stringify(options ?? {}), signal }
  );
}

export async function requestBalletEnrollmentCancellation(
  levelAssignmentId: number,
  payload: { requestedTiming: "immediate" | "endOfPeriod"; reason: string; requestRefund?: boolean },
  signal?: AbortSignal
): Promise<{ cancellationRequest: BalletCancellationRequest; refundCreated: boolean; refund: BalletRefundSummary | null }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  return customFetch(
    `${apiUrl}/api/ballet/enrollments/${levelAssignmentId}/cancellation-requests`,
    { method: "POST", body: JSON.stringify(payload), signal }
  );
}

export async function withdrawBalletEnrollmentCancellationRequest(
  cancellationRequestId: number,
  signal?: AbortSignal
): Promise<{ cancellationRequest: BalletCancellationRequest }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  return customFetch(
    `${apiUrl}/api/ballet/enrollment-cancellation-requests/${cancellationRequestId}/withdraw`,
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
  assessmentScheduleId?:  number;
  assessmentDate?:        string;
  preferredPackageId?:    number;
  preferredPaymentMethod?: BalletPaymentMethod;
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
  "accepted",
  "assignedToLevel",
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
// fetchBalletSettings/fetchAvailableAssessmentSchedules pattern above: no auth beyond the
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

export async function fetchBalletInstructor(
  instructorId: number,
  signal?: AbortSignal
): Promise<BalletInstructor> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<{ instructor: BalletInstructor }>(
    `${apiUrl}/api/ballet/instructors/${instructorId}`,
    { method: "GET", signal }
  );
  return res.instructor;
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
  isActive: boolean;
  description: string | null;
  requirements: string | null;
  imageUrl: string | null;
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
  description: string | null;
  imageUrl: string | null;
  eventType: string;
  locationName: string | null;
  eventDate: string; // ISO date, e.g. "2026-12-20"
  startTime: string;
  endTime: string;
  requirements: string[];
  externalCtaUrl: string | null;
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
