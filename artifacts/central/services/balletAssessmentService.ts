/**
 * services/balletAssessmentService.ts
 *
 * ─── What lives here and why ──────────────────────────────────────────────────
 *
 * STATIC CONFIG  (defined in code — these are programme definitions)
 *   BALLET_LEVELS   — the progression of levels offered by the studio.
 *                     Changes only when the studio restructures its curriculum.
 *                     No user-specific or session-specific state.
 *   BALLET_PRICING  — monthly pricing per level tier.
 *                     Same rationale: studio-wide config, not live availability.
 *
 * DYNAMIC DATA  (must come from the backend)
 *   fetchAssessmentSlots() — real-time slot availability.
 *     Slot availability (capacity, booked counts) changes as parents book.
 *     Hardcoding these is dangerous: a parent could "select" a slot that is
 *     already full or no longer scheduled.
 *
 * ─── Production rule ──────────────────────────────────────────────────────────
 *
 * fetchAssessmentSlots() NEVER falls back to static/mock data.
 * If the endpoint is not available, the screen must show an appropriate state
 * (offline, error, or "coming soon") — not phantom slots.
 *
 * ─── Backend TODO ─────────────────────────────────────────────────────────────
 *
 * The endpoint GET /api/ballet/assessment-slots does not yet exist.
 * When implementing it:
 *   • Return AssessmentSlot[] with live capacity data.
 *   • Only return future slots (filter by date server-side).
 *   • Require student JWT authentication.
 *   • Once live: remove the `throw` in fetchAssessmentSlots() and uncomment
 *     the fetch block below.
 */

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

/** Monthly pricing tiers. Update when studio prices change. */
export const BALLET_PRICING: { level: string; hours: string; price: number }[] =
  [
    { level: "Pre-Ballet", hours: "8 hours monthly", price: 1_950 },
    { level: "Levels 1–9", hours: "12 hours monthly", price: 2_650 },
  ];

// ─── Dynamic slot type ────────────────────────────────────────────────────────

/**
 * Shape of a single assessment appointment slot.
 * Must match the shape returned by GET /api/ballet/assessment-slots.
 */
export interface AssessmentSlot {
  id: string;
  date: string;        // ISO date, e.g. "2026-07-05"
  dayOfWeek: string;   // "Saturday"
  startTime: string;   // "10:00 AM"
  endTime: string;     // "10:30 AM"
  capacity: number;
  bookedCount: number;
  availableSeats: number;
  status: "available" | "fewSeats" | "full";
}

// ─── Fetch function ────────────────────────────────────────────────────────────

/**
 * Fetches live assessment slot availability from the backend.
 *
 * Throws on any failure (network error OR server error) — the calling screen
 * is responsible for catching and rendering the appropriate state.
 *
 * TODO: When the backend endpoint is ready —
 *   1. Remove the `throw new Error("ENDPOINT_NOT_READY")` line.
 *   2. Uncomment the fetch block below.
 *   3. Verify the response shape matches AssessmentSlot[].
 *   4. Endpoint:  GET /api/ballet/assessment-slots
 *      Auth:      Bearer token (student JWT)
 *      Response:  AssessmentSlot[]  (future slots only, ordered by date asc)
 */
export async function fetchAssessmentSlots(
  signal?: AbortSignal
): Promise<AssessmentSlot[]> {
  // ── TODO: Uncomment when endpoint is live ─────────────────────────────────
  //
  // const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  // const res = await fetch(`${apiUrl}/api/ballet/assessment-slots`, {
  //   method: "GET",
  //   headers: { "Content-Type": "application/json" },
  //   signal,
  // });
  // if (!res.ok) {
  //   throw new Error(`Server error: ${res.status}`);
  // }
  // return res.json() as Promise<AssessmentSlot[]>;
  //
  // ─────────────────────────────────────────────────────────────────────────

  // Endpoint not yet implemented.  Throw intentionally so the screen renders
  // an "unavailable" error state rather than showing stale hardcoded slots
  // that may no longer be valid.
  throw new Error("ENDPOINT_NOT_READY");
}
