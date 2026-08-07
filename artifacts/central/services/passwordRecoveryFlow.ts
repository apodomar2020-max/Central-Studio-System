/**
 * Pure decision logic for the Forgot Password / Reset Password / Change
 * Password screens — kept out of the .tsx files so it can be unit-tested
 * directly, matching the pattern already used by bookingErrorMessages.ts /
 * logoutCoordinator.ts elsewhere in this app.
 */

/** Minimal shape of a customFetch ApiError, extracted so this module never
 *  needs to import the real ApiError class to stay trivially testable. */
export type ApiErrorLike = {
  status?: number;
  data?: unknown;
};

/**
 * Structurally extracts { status, data } from a caught customFetch error,
 * without importing the ApiError class itself — it isn't re-exported from
 * @workspace/api-client-react's public entry point (only from its internal
 * custom-fetch module). Mirrors the same duck-typed extraction verify-email.tsx's
 * otpErrorData() already uses for the identical problem. Returns null for
 * anything not shaped like an ApiError (e.g. a plain network failure), so
 * callers can distinguish "the server responded with an error" from "the
 * request never reached the server."
 */
export function toApiErrorLike(err: unknown): ApiErrorLike | null {
  if (!err || typeof err !== "object" || !("data" in err)) return null;
  const status = "status" in err && typeof (err as { status?: unknown }).status === "number"
    ? (err as { status: number }).status
    : undefined;
  return { status, data: (err as { data?: unknown }).data };
}

function errorMessageFrom(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

/**
 * Forgot Password: deliberately ignores the response body entirely. Central
 * Studio's backend intentionally returns the same generic 2xx response
 * whether or not an account exists for the submitted email (see
 * GENERIC_RESET_RESPONSE in auth.ts) — the client must never attempt to
 * infer account existence from it, so this function doesn't even accept a
 * body parameter that could tempt a future caller into branching on one.
 */
export function forgotPasswordOutcome(): { action: "continue-to-reset" } {
  return { action: "continue-to-reset" };
}

export type ResetPasswordOutcome =
  | { kind: "success" }
  | { kind: "locked"; message: string }
  | { kind: "error"; message: string };

/** Maps a reset-password request's outcome. Pass `null` for a successful
 *  (2xx) response; pass the caught ApiError-like object otherwise. */
export function resetPasswordOutcome(error: ApiErrorLike | null): ResetPasswordOutcome {
  if (!error) return { kind: "success" };
  if (error.status === 429) {
    return { kind: "locked", message: errorMessageFrom(error.data, "Too many incorrect attempts. Please request a new code.") };
  }
  return { kind: "error", message: errorMessageFrom(error.data, "Reset failed. Please try again.") };
}

export type ChangePasswordOutcome = { kind: "success" } | { kind: "error"; message: string };

/** Maps a change-password request's outcome. Pass `null` for a successful
 *  (2xx) response; pass the caught ApiError-like object otherwise. A failed
 *  request must never map to "success" — that is the exact defect this
 *  screen previously had (a fake setTimeout that always succeeded). */
export function changePasswordOutcome(error: ApiErrorLike | null): ChangePasswordOutcome {
  if (!error) return { kind: "success" };
  return { kind: "error", message: errorMessageFrom(error.data, "We couldn't update your password. Please try again.") };
}

/** Builds the exact backend contract for POST /api/auth/reset-password —
 *  { email, code, newPassword } — with no studentId field, ever. */
export function buildResetPasswordPayload(email: string, code: string, newPassword: string): {
  email: string;
  code: string;
  newPassword: string;
} {
  return { email: email.trim(), code: code.trim(), newPassword };
}

/** Builds the exact backend contract for POST /api/auth/change-password —
 *  { currentPassword, newPassword }. Identity comes from the JWT the shared
 *  customFetch auth-token getter already attaches; no identity field belongs
 *  in this body. */
export function buildChangePasswordPayload(currentPassword: string, newPassword: string): {
  currentPassword: string;
  newPassword: string;
} {
  return { currentPassword, newPassword };
}
