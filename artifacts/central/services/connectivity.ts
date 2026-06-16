/**
 * services/connectivity.ts
 *
 * Single source of truth for offline vs. server-error detection.
 *
 * WHY THIS EXISTS:
 * customFetch (from @workspace/api-client-react) throws two distinct error types:
 *   - TypeError  → device is offline / network unreachable / DNS failure
 *   - Other Error → server was reachable but returned an HTTP error (4xx / 5xx)
 *
 * Spreading `error instanceof TypeError` across every screen is fragile —
 * it would require updating every file if we ever switch to a native NetInfo
 * library or if the error type changes.  This module is the single place to
 * make that change.
 *
 * TODO: Replace the HEAD-probe approach with @react-native-community/netinfo
 *       when that package is added.  NetInfo gives instant detection without a
 *       network round-trip and handles edge cases (captive portals,
 *       cell-to-wifi handoff).  Only probeConnectivity() below needs updating;
 *       isOfflineError / isServerError stay the same.
 */

// ─── Error classification ─────────────────────────────────────────────────────

/**
 * Returns true when the error represents a network failure (device offline,
 * DNS unreachable, connection refused).
 *
 * Returns false when the server was reachable but responded with an HTTP error.
 */
export function isOfflineError(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * Complement of isOfflineError.  True when the server responded with an error
 * (4xx / 5xx), meaning the device IS connected but the API returned a failure.
 */
export function isServerError(error: unknown): boolean {
  return error != null && !isOfflineError(error);
}

// ─── Active connectivity probe ────────────────────────────────────────────────

/**
 * Sends a lightweight HEAD request to a known API endpoint to check whether
 * the backend is reachable.
 *
 * Use this ONLY for screens that need to gate access before loading heavier
 * resources — e.g., the ballet assessment form, which should not be started
 * if the student can't submit.  For normal data screens, let React Query run
 * the real request and pass its error to isOfflineError() instead.
 *
 * - server responds (any status) → "online"
 * - TypeError thrown             → "offline"
 * - AbortError (signal fired)    → re-throws (let caller handle cancellation)
 */
export async function probeConnectivity(
  signal?: AbortSignal
): Promise<"online" | "offline"> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  try {
    // /api/packages is a lightweight, always-available endpoint.
    // Swap for /api/health once a dedicated health-check route is added.
    await fetch(`${apiUrl}/api/packages`, { method: "HEAD", signal });
    return "online";
  } catch (e) {
    if ((e as any)?.name === "AbortError") throw e;
    return isOfflineError(e) ? "offline" : "online";
  }
}
