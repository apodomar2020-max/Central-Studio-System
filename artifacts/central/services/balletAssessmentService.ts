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
 * No student JWT required — slot availability is public programme info.
 * The shared API key (set in EXPO_PUBLIC_API_KEY) is sufficient.
 *
 * Throws on any failure — the calling screen catches and renders the
 * appropriate state (use isOfflineError() to distinguish offline vs error).
 */
export async function fetchAssessmentSlots(
  signal?: AbortSignal
): Promise<AssessmentSlot[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const res = await customFetch<AssessmentSlot[]>(
    `${apiUrl}/api/ballet/assessment-slots`,
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

// Re-export so callers can check offline status without importing connectivity separately.
export { isOfflineError };
