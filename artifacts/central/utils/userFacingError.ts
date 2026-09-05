type ApiErrorLike = {
  status?: unknown;
  data?: unknown;
};

const TECHNICAL_ERROR_PATTERN =
  /\bHTTP\s*\d{3}\b|internal server|failed query|postgres|\bSQL\b|endpoint|stack trace|exception|ECONN|fetch failed|unknown error/i;

function errorData(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as ApiErrorLike).data;
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

export function userFacingErrorCode(error: unknown): string | null {
  const code = errorData(error)?.code;
  return typeof code === "string" ? code : null;
}

function safeMessage(error: unknown): string | null {
  const data = errorData(error);
  const candidate = data?.error ?? data?.message ?? (error instanceof Error ? error.message : null);
  if (typeof candidate !== "string") return null;
  const message = candidate.trim();
  return message && !TECHNICAL_ERROR_PATTERN.test(message) ? message : null;
}

/** Keeps actionable business copy but never exposes transport/server internals. */
export function presentUserFacingError(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof TypeError) return "Please check your internet connection and try again.";

  const status = error && typeof error === "object" ? Number((error as ApiErrorLike).status) : NaN;
  if (!Number.isFinite(status) || status < 500) return safeMessage(error) ?? fallback;
  return fallback;
}
