/**
 * services/bookingsRepository.ts
 *
 * API-first booking data layer for the mobile app.
 *
 * ─── Source of truth hierarchy ────────────────────────────────────────────────
 *
 *  1. Backend API  (/api/bookings?studentEmail=...)
 *     The backend is the authoritative source for booking STATUS.
 *     Admins can update statuses (cancel, mark attended, refund) via the
 *     admin dashboard.  The mobile app must reflect those changes.
 *
 *  2. AsyncStorage cache (key: "api_bookings_cache_<email>")
 *     Fallback ONLY when the device is offline AND a prior successful API
 *     sync exists.  Cached data is flagged `fromCache: true` so the UI can
 *     show a "may be out of date" banner.
 *
 *  3. AppContext local bookings  — NOT used here.
 *     AppContext bookings are the write-side (created optimistically on booking).
 *     They carry the display metadata (class name, instructor, time, location)
 *     that the API currently does not return.  The bookings.tsx screen MERGES
 *     local display data with the API status records from this repository.
 *
 * ─── Offline behaviour ────────────────────────────────────────────────────────
 *
 *  Offline + cache exists  → return { bookings: cached, fromCache: true }
 *  Offline + no cache      → re-throw TypeError  → OfflineState
 *  Server error            → re-throw Error      → ErrorState
 *                            (never serve stale cache on server errors —
 *                             the server may be intentionally rejecting the
 *                             request, e.g. auth revoked)
 *
 * ─── Backend TODOs ────────────────────────────────────────────────────────────
 *
 *  TODO-1: Student-scoped endpoint.
 *    The current /api/bookings returns ALL bookings (admin view).
 *    We filter client-side by studentEmail as an interim measure, which is
 *    insecure (any client can spoof a different email in the query string).
 *    The proper fix is a JWT-scoped endpoint:
 *      GET /api/me/bookings  → returns only the authenticated student's bookings
 *    When that endpoint exists, replace `listBookings({ studentEmail })` with
 *    a call to `listMyBookings()` (to be added to the API client).
 *
 *  TODO-2: Enriched booking response.
 *    The current Booking schema only has classId / scheduleId — not the class
 *    name, instructor name, schedule time, or location.  The mobile BookingCard
 *    needs those fields, so we currently overlay them from AppContext local data.
 *    When the backend returns enriched bookings (via JOIN with classes /
 *    schedules / instructors), remove the local-data merge from bookings.tsx
 *    and render directly from the API response.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { listBookings } from "@workspace/api-client-react";
import { isOfflineError } from "@/services/connectivity";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal record returned by GET /api/bookings.
 * Note: this is a status record — it does NOT contain display metadata
 * (class name, instructor, location).  See TODO-2 above.
 */
export interface ApiBookingStatus {
  id: number;           // Matches String(id) in AppContext local bookings
  studentEmail: string;
  classId?: number | null;
  scheduleId?: number | null;
  packageId?: number | null;
  /** The canonical booking status from the backend (e.g. "confirmed", "cancelled"). */
  status: string;
  bookingStatus?: string;
  paymentStatus?: string;
  paymentMode?: string | null;
  bookedAt: string;
  createdAt: string;
}

export interface BookingsResult {
  bookings: ApiBookingStatus[];
  /**
   * True when the response came from AsyncStorage cache because the device
   * was offline.  The UI should display a "may be out of date" notice.
   */
  fromCache: boolean;
}

// ─── AsyncStorage cache ───────────────────────────────────────────────────────

const CACHE_PREFIX = "api_bookings_cache_";

function cacheKey(email: string): string {
  return CACHE_PREFIX + email.toLowerCase().trim();
}

async function readCache(email: string): Promise<ApiBookingStatus[] | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(email));
    return raw ? (JSON.parse(raw) as ApiBookingStatus[]) : null;
  } catch {
    return null;
  }
}

async function writeCache(email: string, data: ApiBookingStatus[]): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(email), JSON.stringify(data));
  } catch {
    // Cache write failure is non-fatal; live data is still usable.
  }
}

// ─── Repository ───────────────────────────────────────────────────────────────

/**
 * Fetches the API status records for a student's bookings.
 *
 * @param studentEmail — the logged-in student's email.
 *   TODO: Replace with a JWT-scoped endpoint (see TODO-1 above).
 */
export async function fetchStudentBookings(
  studentEmail: string
): Promise<BookingsResult> {
  try {
    // Fetch bookings filtered by this student's email.
    // TODO: Switch to listBookings({ studentEmail }) once the backend query
    //       param is active, or to listMyBookings() once the scoped endpoint
    //       exists.  For now the backend already supports ?studentEmail= (added
    //       in the same hardening pass), so we pass it directly.
    const all = await listBookings({ studentEmail });
    const mine = all as ApiBookingStatus[];

    // Success — persist to cache so we can serve it offline next time.
    await writeCache(studentEmail, mine);
    return { bookings: mine, fromCache: false };
  } catch (err) {
    if (isOfflineError(err)) {
      // Device is offline — try to serve the cache.
      const cached = await readCache(studentEmail);
      if (cached) {
        return { bookings: cached, fromCache: true };
      }
      // No cache available — re-throw so the screen shows OfflineState.
      throw err;
    }
    // Server error — do NOT fall back to cache; the server's rejection
    // may be intentional (auth revoked, account suspended, etc.).
    throw err;
  }
}

// ─── Status mapping ───────────────────────────────────────────────────────────

/**
 * Maps a backend booking status string to the mobile app's bookingStatus enum.
 * The mobile enum is stricter than the backend's open string field.
 */
export function mapApiStatusToLocal(
  apiStatus: string
): "pending" | "confirmed" | "rejected" | "cancelled" | "attended" | "completed" | "noShow" {
  const map: Record<string, ReturnType<typeof mapApiStatusToLocal>> = {
    pending: "pending",
    confirmed: "confirmed",
    pendingPayment: "pending",
    rejected: "rejected",
    cancelled: "cancelled",
    attended: "attended",
    completed: "completed",
    noShow: "noShow",
    no_show: "noShow",
  };
  return map[apiStatus] ?? "confirmed";
}

export function mapApiPaymentStatusToLocal(
  apiStatus: string | undefined,
): "not_required" | "pending_payment" | "paid" | "refunded" | "failed" {
  switch (apiStatus) {
    case "pending_payment":
    case "paid":
    case "refunded":
    case "failed":
    case "not_required":
      return apiStatus;
    case "unpaid":
      return "pending_payment";
    default:
      return "not_required";
  }
}
