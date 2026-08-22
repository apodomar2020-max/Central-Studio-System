/**
 * Student Account Lifecycle — Phase B1C.
 *
 * Shared copy + a tiny bridge used to route a `401 { code: "ACCOUNT_DEACTIVATED" }`
 * response into a single, one-time, user-facing message — reused by both the
 * "already signed in" tear-down path (AppContext's handler) and the "fresh
 * login attempt" paths (login.tsx, useGoogleSignIn, useFacebookSignIn) so the
 * copy never drifts between the two.
 */
export const ACCOUNT_DEACTIVATED_MESSAGE =
  "Your account has been deactivated. Please contact Central Studio if you need help.";

/**
 * Shared by login.tsx, useGoogleSignIn.ts, and useFacebookSignIn.ts — the
 * three "fresh auth attempt" call sites that each parse a failed
 * `POST /api/auth/{login,google,facebook}` response directly (they predate
 * customFetch/the centralized 401-handler mechanism and have no existing
 * session to tear down). Ensures all three surface the exact same copy for
 * ACCOUNT_DEACTIVATED and never show it as a generic "wrong credentials"
 * error, without duplicating the branching three times.
 */
export function deriveAuthErrorMessage(
  data: { code?: string; error?: string } | null | undefined,
  fallback: string,
): string {
  if (data?.code === "ACCOUNT_DEACTIVATED") return ACCOUNT_DEACTIVATED_MESSAGE;
  return data?.error ?? fallback;
}
