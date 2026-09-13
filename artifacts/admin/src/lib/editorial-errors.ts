/**
 * editorial-errors — Editorial-scoped failure interpretation (Wave 2.1A).
 *
 * The Editorial API answers every failure with the shared `ErrorResponse`
 * body `{ error: string }`. For 4xx the backend message is already
 * editor-grade and written for the person looking at the screen ("A post with
 * this slug already exists", "This translation is already published"), so it
 * should be shown verbatim. For 5xx it is an internal failure description and
 * must never be surfaced — Editorial screens show a fixed generic message
 * instead.
 *
 * Scope: Editorial pages only. The rest of Admin keeps its existing
 * `err instanceof Error ? err.message : String(err)` toast convention; this
 * helper deliberately does not touch or replace it.
 *
 * Deliberately dependency-free (no imports, no `instanceof ApiError`): the
 * generated client's ApiError is duck-typed here by its `status`/`data`
 * shape, which keeps this module directly unit-testable and immune to
 * cross-bundle identity problems.
 */

/** Shown whenever the backend's own words must not be repeated to the user. */
export const EDITORIAL_GENERIC_ERROR_MESSAGE =
  "Something went wrong. Please try again, and contact an administrator if the problem continues.";

export interface EditorialError {
  /** HTTP status when the failure came from the API, otherwise null. */
  status: number | null;
  /** The message safe to display. */
  message: string;
  /** True when the backend message was shown verbatim. */
  isBackendMessage: boolean;
  /** True for 5xx or for anything that is not a recognisable API failure. */
  isServerError: boolean;
}

function readStatus(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

function readBackendMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const message = (data as { error?: unknown }).error;
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Normalise anything thrown by an Editorial API call into a status plus a
 * message that is always safe to render.
 */
export function toEditorialError(err: unknown): EditorialError {
  const status = readStatus(err);

  // Not a recognisable API failure at all (network error, unexpected throw,
  // a plain Error, a string, null) — never echo it, it can carry internals.
  if (status === null) {
    return {
      status: null,
      message: EDITORIAL_GENERIC_ERROR_MESSAGE,
      isBackendMessage: false,
      isServerError: true,
    };
  }

  // 5xx — the body describes an internal failure. Never surface it.
  if (status >= 500) {
    return {
      status,
      message: EDITORIAL_GENERIC_ERROR_MESSAGE,
      isBackendMessage: false,
      isServerError: true,
    };
  }

  const backendMessage = readBackendMessage(err);
  if (backendMessage === null) {
    // A 4xx with no usable `{ error }` body — fall back rather than render
    // an empty toast.
    return {
      status,
      message: EDITORIAL_GENERIC_ERROR_MESSAGE,
      isBackendMessage: false,
      isServerError: false,
    };
  }

  return { status, message: backendMessage, isBackendMessage: true, isServerError: false };
}

/** Convenience wrapper for toast bodies. */
export function editorialErrorMessage(err: unknown): string {
  return toEditorialError(err).message;
}
