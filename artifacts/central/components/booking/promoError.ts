const FALLBACK_PROMO_ERROR = "This promo code could not be applied. Please check the code and try again.";

const CODE_MESSAGES: Record<string, string> = {
  invalid_promotion_context: "This promo code cannot be checked for the selected class.",
  promotion_not_eligible: "This promo code is not eligible for the selected class.",
  promotion_changed: "This promotion changed. Please check the code again.",
  promo_code_not_found: "This promo code is invalid or has expired.",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function isTechnicalMessage(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith("[")
    || normalized.startsWith("{")
    || /invalid_type|received\s+nan|expected\s+(?:number|string)|zod|packageid|scheduleid|\"path\"|stack trace/i.test(normalized);
}

function friendlyCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || isTechnicalMessage(normalized)) return null;
  return CODE_MESSAGES[normalized.toLowerCase()] ?? normalized;
}

export function getFriendlyPromoError(error: unknown): string {
  const root = asRecord(error);
  const data = asRecord(root?.data);
  const rawCode = typeof data?.code === "string"
    ? data.code
    : typeof root?.code === "string"
      ? root.code
      : null;
  if (rawCode && CODE_MESSAGES[rawCode.trim().toLowerCase()]) {
    return CODE_MESSAGES[rawCode.trim().toLowerCase()];
  }

  const candidates = [data?.reason, data?.message, data?.error, root?.reason, root?.message, root?.error, error];
  for (const candidate of candidates) {
    const friendly = friendlyCandidate(candidate);
    if (friendly) return friendly;
  }
  return FALLBACK_PROMO_ERROR;
}

export { FALLBACK_PROMO_ERROR };
