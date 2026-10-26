import { readPromotionConditions, validatePromotionConditions } from "./promotionConditions";

// Same persisted recovery form shape as the existing Admin save protocol.
export type PromotionFormState = {
  name: string; description: string; type: "automatic" | "manual";
  discountType: "percentage" | "fixed_amount"; discountValue: string; priority: string;
  isExclusive: boolean; isStackable: boolean; isActive: boolean;
  startDate: string; endDate: string; code: string; maxUses: string; usesPerUser: string; rulesConfig: string;
};
export type PromotionFormErrors = Record<string, string>;
export const conditionLabels: Record<string, string> = {
  verifiedStudentOnly: "Verified students only",
  minimumBasketAmount: "Minimum purchase (EGP)", maxGlobalUses: "Total promotion redemptions",
  maxUsesPerUser: "Promotion redemptions per customer", branches: "Eligible branches",
};
export function validatePromotionForm(form: PromotionFormState): PromotionFormErrors {
  const errors: PromotionFormErrors = {};
  const number = (v: string) => v.trim() !== "" && Number.isFinite(Number(v));
  const limit = (v: string) => !v.trim() || (number(v) && Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) <= 2147483647);
  if (!form.name.trim() || form.name.includes("\0")) errors.name = "Enter a promotion name.";
  if (!number(form.discountValue) || Number(form.discountValue) <= 0 || !Number.isSafeInteger(Math.round(Number(form.discountValue) * 100))) errors.discountValue = "Enter a discount greater than zero within the supported amount range.";
  else if (form.discountType === "percentage" && Number(form.discountValue) > 100) errors.discountValue = "Enter a percentage greater than 0 and no more than 100.";
  if (form.type === "manual" && (form.code.trim().length < 3 || form.code.includes("\0"))) errors.code = "Enter a promo code with at least 3 characters.";
  if (!limit(form.maxUses)) errors.maxUses = "Enter a positive whole number, or leave blank for no limit.";
  if (!limit(form.usesPerUser)) errors.usesPerUser = "Enter a positive whole number, or leave blank for no limit.";
  if (form.type === "automatic" && (form.maxUses.trim() || form.usesPerUser.trim())) errors.type = "This promotion still has code limits. Switch back to Promo Code and review them before changing its type.";
  if (!number(form.priority) || !Number.isInteger(Number(form.priority)) || Number(form.priority) < -2147483648 || Number(form.priority) > 2147483647) errors.priority = "Enter a whole-number priority within the supported range.";
  for (const key of ["startDate", "endDate"] as const) if (form[key] && !Number.isFinite(new Date(form[key]).getTime())) errors[key] = "Choose a valid date and time.";
  if (form.startDate && form.endDate && new Date(form.endDate).getTime() < new Date(form.startDate).getTime()) errors.endDate = "End date cannot precede start date.";
  try {
    const rules = readPromotionConditions(form.rulesConfig);
    for (const [key, value] of Object.entries(rules)) {
      try { validatePromotionConditions(JSON.stringify({ [key]: value })); }
      catch { errors[key] = Object.prototype.hasOwnProperty.call(conditionLabels, key) ? `Review ${conditionLabels[key].toLowerCase()}. Use a valid value; usage limits must be positive whole numbers.` : "Saved conditions need review. Unsupported settings have been preserved."; }
    }
  } catch { errors.rulesConfig = "Saved conditions are malformed and have been preserved. Review is required before saving."; }
  return errors;
}

export function promotionSummary(form: PromotionFormState): string[] {
  let rules: Record<string, unknown>;
  try { rules = validatePromotionConditions(form.rulesConfig); }
  catch { return ["Saved conditions need review before this promotion can be safely summarized or saved."]; }
  const amount = Number(form.discountValue);
  const summary = [Number.isFinite(amount) && amount > 0 && (form.discountType !== "percentage" || amount <= 100)
    ? `${form.discountType === "percentage" ? `${amount}%` : `EGP ${amount}`} off eligible purchases${form.type === "manual" ? ` with promo code ${form.code.trim() || "(enter a code)"}` : ", applied automatically"}.`
    : "Enter a valid discount to complete this summary."];
  summary.push(rules.verifiedStudentOnly ? "For verified student accounts." : "For everyone who meets the purchase conditions.");
  summary.push("Direct Single Class purchases only. Packages and package-credit bookings are excluded.");
  const format = (date: string) => Number.isFinite(new Date(date).getTime()) ? new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "a valid date is needed";
  summary.push(`${form.isActive ? (form.startDate ? `Starts ${format(form.startDate)}` : "Starts immediately") : "Inactive — not available at checkout"}${form.endDate ? `; ends ${format(form.endDate)}` : "; no end date"}.`);
  if (rules.minimumBasketAmount != null) summary.push(`Minimum purchase: EGP ${rules.minimumBasketAmount}.`);
  if (rules.maxGlobalUses != null) summary.push(`Promotion limit: ${rules.maxGlobalUses} total redemptions.`);
  if (rules.maxUsesPerUser != null) summary.push(`Promotion limit: ${rules.maxUsesPerUser} redemptions per customer.`);
  if (form.type === "manual" && form.maxUses) summary.push(`Code limit: ${form.maxUses} total uses.`);
  if (form.type === "manual" && form.usesPerUser) summary.push(`Code limit: ${form.usesPerUser} uses per customer.`);
  const branches = rules.branches as string[] | undefined;
  if (branches?.length) summary.push(`Branches: ${branches.join(", ")}. Direct Single Class purchases without a matching branch do not qualify.`);
  summary.push(form.isStackable ? "Can combine only when all eligible promotions allow combining." : "Does not combine: checkout selects the best eligible discount.");
  if (Number(form.priority)) summary.push(`Priority ${form.priority} breaks ties between equal discounts.`);
  if (form.isExclusive) summary.push("Exclusive flag is saved; it does not independently prevent other discounts.");
  return summary;
}
