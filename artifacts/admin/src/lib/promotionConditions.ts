/** The existing API rules contract; this editor never invents eligibility rules. */
export function readPromotionConditions(raw: string): Record<string, unknown> {
  const value: unknown = raw.trim() ? JSON.parse(raw) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Saved conditions need review before editing.");
  return value as Record<string, unknown>;
}

export function validatePromotionConditions(raw: string): Record<string, unknown> {
  const rules = readPromotionConditions(raw);
  const integer = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2_147_483_647;
  for (const [key, value] of Object.entries(rules)) {
    let valid = false;
    switch (key) {
      case "verifiedStudentOnly": valid = typeof value === "boolean"; break;
      case "minimumBasketAmount": valid = typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)); break;
      case "maxGlobalUses": case "maxUsesPerUser": valid = integer(value); break;
      case "packageIds": case "firstPackagePurchaseOnly": throw Error("Saved package-specific conditions are preserved and incompatible with Direct Single Class promotions. Deactivate this promotion and create a new one.");
      case "branches": valid = Array.isArray(value) && value.every(v => typeof v === "string" && v.trim().length > 0 && !v.includes("\0")); break;
      default: throw Error(`The saved condition “${key}” is unsupported. Review this legacy configuration before saving; it has not been removed.`);
    }
    if (!valid) throw Error(`Check the value for “${key}”. Limits must be positive whole numbers; the minimum amount must be zero or greater.`);
  }
  return rules;
}

export function changePromotionCondition(raw: string, key: string, value: unknown): string {
  const rules = { ...readPromotionConditions(raw) };
  if (value === undefined) delete rules[key]; else rules[key] = value;
  return JSON.stringify(rules, null, 2);
}
