/** Native admission failures are deliberately described without abuse-control details. */
export function nativeAuthError(error: unknown): { message: string; retryAfter: number } {
  const response = error && typeof error === "object" ? error as { status?: unknown; data?: unknown } : {};
  const data = response.data && typeof response.data === "object"
    ? response.data as { retryAfter?: unknown; retryAfterSeconds?: unknown } : {};
  const retry = data.retryAfterSeconds ?? data.retryAfter;
  const retryAfter = typeof retry === "number" && Number.isFinite(retry) && retry > 0
    ? Math.ceil(retry) : 0;
  const message = response.status === 401 || response.status === 403
    ? "Your session has expired. Please sign in again."
    : response.status === 429
      ? "Please wait before requesting another code."
      : response.status === 503
        ? "Email delivery is temporarily unavailable. Please try again later."
        : typeof response.status === "number"
          ? "We couldn't send the code. Please try again."
          : "Network error. Please check your connection.";
  return { message, retryAfter };
}
