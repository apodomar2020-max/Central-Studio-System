/** Display expected API rejections, never raw server errors or response bodies. */
export function scheduleCreationErrorMessage(error: unknown): string {
  const fallback = "Failed to create schedule. Please try again.";
  if (!error || typeof error !== "object") return fallback;
  const value = error as { status?: number; data?: { error?: unknown; message?: unknown; code?: unknown } };
  if (value.status != null && value.status >= 500) return "The server could not create the schedule. Please try again or contact support.";
  const message = value.data?.message ?? value.data?.error;
  if (typeof message !== "string" || !message.trim()) return fallback;
  const code = value.data?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)
    ? `${message.trim()} (${code})`
    : message.trim();
}
