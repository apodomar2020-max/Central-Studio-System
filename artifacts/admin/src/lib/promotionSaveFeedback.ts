/** A successful response that cannot be read, a timeout, or a server/network
 * failure cannot establish whether a mutation committed. Never suggest retrying
 * automatically; durable operation replay is still a separate release blocker. */
export function promotionMutationFailure(error: unknown, action: "save" | "deactivate") {
  // customFetch exposes ApiError.status, but deliberately does not export the
  // class from the package entry point. Check its actual structured contract.
  const httpError = error instanceof Error && error.name === "ApiError" && "status" in error && typeof error.status === "number"
    ? error as Error & { status: number; data?: { code?: unknown; error?: unknown; message?: unknown } | null } : null;
  if (httpError && httpError.status >= 400 && httpError.status < 500 && httpError.status !== 408) {
    const data = httpError.data;
    const reload = httpError.status === 428 || (httpError.status === 409 && data?.code === "PROMOTION_CHANGED");
    const detail = typeof data?.error === "string" ? data.error
      : typeof data?.message === "string" ? data.message : httpError.message;
    return {
      outcome: "rejected" as const,
      reload,
      message: `${detail}${reload ? " Close and reopen the promotion to review its latest values. Your entered values remain here until you do." : ""}`,
    };
  }
  return {
    outcome: "uncertain" as const,
    reload: false,
    message: action === "save"
      ? "The save outcome could not be confirmed. Your entries are preserved. Refresh Promotions and check whether it saved before submitting again."
      : "Deactivation could not be confirmed. Refresh Promotions and check its current status before trying again.",
  };
}

export function promotionRefreshFailure(error: unknown, confirmed?: "saved" | "deactivated") {
  if (confirmed) return `Promotion ${confirmed}, but the list could not be refreshed. Refresh Promotions to see its current state.`;
  return error instanceof Error ? error.message : "Failed to load promotions.";
}
