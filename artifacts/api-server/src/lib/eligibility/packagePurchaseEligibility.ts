import type { AgeRange, EligibilityReason, EligibilityResult } from "@workspace/api-zod";
import { calculateAgeOnDate, getCairoBusinessDate, parseIsoDate } from "./dateOnly";
import { evaluateAgeRange } from "./ageRange";
import type { IsoDate } from "./types";

type NullablePackageRange = {
  allowAllAges: boolean | null;
  minAge: number | null;
  maxAge: number | null;
};

export type PurchaseEligibilitySnapshot = {
  participantDateOfBirthSnapshot: IsoDate;
  participantAgeAtPurchase: number;
  eligibilityEvaluatedOn: IsoDate;
  packageAllowAllAgesSnapshot: boolean | null;
  packageMinAgeSnapshot: number | null;
  packageMaxAgeSnapshot: number | null;
  purchaseEligibilityConfigurationState: "configured" | "legacy_unconfigured";
};

export type PackagePurchaseEligibility =
  | { eligible: true; value: PurchaseEligibilitySnapshot; warnings: EligibilityReason[] }
  | { eligible: false; reasons: EligibilityReason[] };

export function evaluatePackagePurchaseEligibility(
  dateOfBirth: string | null,
  range: NullablePackageRange,
  evaluationDate: IsoDate = getCairoBusinessDate(),
): PackagePurchaseEligibility {
  const parsedDob = parseIsoDate(dateOfBirth, { today: evaluationDate });
  if (!parsedDob.eligible || !parsedDob.value) {
    return parsedDob.eligible
      ? { eligible: false, reasons: [{ code: "DOB_INVALID", message: "Date of birth is invalid." }] }
      : parsedDob;
  }

  const participantAgeAtPurchase = calculateAgeOnDate(parsedDob.value, evaluationDate);
  const legacyUnconfigured =
    range.allowAllAges == null && range.minAge == null && range.maxAge == null;

  if (!legacyUnconfigured) {
    const eligibility: EligibilityResult = evaluateAgeRange(
      participantAgeAtPurchase,
      range as AgeRange,
    );
    if (!eligibility.eligible) return eligibility;
  }

  return {
    eligible: true,
    warnings: legacyUnconfigured
      ? [{
          code: "PACKAGE_NOT_ELIGIBLE",
          message: "Package age eligibility is temporarily unconfigured; purchase was allowed for compatibility.",
          details: { configurationState: "legacy_unconfigured" },
        }]
      : [],
    value: {
      participantDateOfBirthSnapshot: parsedDob.value,
      participantAgeAtPurchase,
      eligibilityEvaluatedOn: evaluationDate,
      packageAllowAllAgesSnapshot: range.allowAllAges,
      packageMinAgeSnapshot: range.minAge,
      packageMaxAgeSnapshot: range.maxAge,
      purchaseEligibilityConfigurationState: legacyUnconfigured
        ? "legacy_unconfigured"
        : "configured",
    },
  };
}
