import type { AgeRange, EligibilityReason, EligibilityResult } from "@workspace/api-zod";
import { deriveAgeRangeLabel, evaluateAgeRange } from "./ageRange";
import { calculateAgeOnDate, getCairoBusinessDate, parseIsoDate } from "./dateOnly";
import type { IsoDate } from "./types";

export type CatalogueConfigurationState = "configured" | "legacy_unconfigured";

export interface AgeRangeMetadata {
  allowAllAges: boolean | null;
  minAge: number | null;
  maxAge: number | null;
  ageRangeLabel: string;
  configurationState: CatalogueConfigurationState;
}

export interface CatalogueEligibility {
  evaluated: boolean;
  eligible: boolean | null;
  evaluatedOn: IsoDate | null;
  participantType?: "self";
  participantAge?: number | null;
  reasons: EligibilityReason[];
}

export interface CatalogueViewer {
  kind: "guest" | "student" | "parent" | "admin";
  studentId?: number;
  dateOfBirth?: string | null;
}

type NullableAgeRange = {
  allowAllAges: boolean | null;
  minAge: number | null;
  maxAge: number | null;
};

export function ageRangeMetadata(range: NullableAgeRange): AgeRangeMetadata {
  if (range.allowAllAges == null && range.minAge == null && range.maxAge == null) {
    return {
      ...range,
      ageRangeLabel: "Not configured",
      configurationState: "legacy_unconfigured",
    };
  }
  return {
    ...range,
    ageRangeLabel: deriveAgeRangeLabel(range as AgeRange),
    configurationState: "configured",
  };
}

function notEvaluated(): CatalogueEligibility {
  return {
    evaluated: false,
    eligible: null,
    evaluatedOn: null,
    reasons: [],
  };
}

export function evaluateCatalogueAge(
  viewer: CatalogueViewer,
  range: NullableAgeRange,
  evaluationDate: IsoDate,
): CatalogueEligibility {
  if (viewer.kind !== "student") return notEvaluated();

  const parsedDob = parseIsoDate(viewer.dateOfBirth, { today: evaluationDate });
  if (!parsedDob.eligible || !parsedDob.value) {
    return {
      evaluated: true,
      eligible: false,
      evaluatedOn: evaluationDate,
      participantType: "self",
      participantAge: null,
      reasons: parsedDob.eligible
        ? [{ code: "DOB_INVALID", message: "Date of birth is invalid." }]
        : parsedDob.reasons,
    };
  }

  const age = calculateAgeOnDate(parsedDob.value, evaluationDate);
  const metadata = ageRangeMetadata(range);
  if (metadata.configurationState === "legacy_unconfigured") {
    return {
      evaluated: true,
      eligible: true,
      evaluatedOn: evaluationDate,
      participantType: "self",
      participantAge: age,
      reasons: [],
    };
  }

  const result: EligibilityResult = evaluateAgeRange(age, range as AgeRange);
  return result.eligible
    ? {
        evaluated: true,
        eligible: true,
        evaluatedOn: evaluationDate,
        participantType: "self",
        participantAge: age,
        reasons: [],
      }
    : {
        evaluated: true,
        eligible: false,
        evaluatedOn: evaluationDate,
        participantType: "self",
        participantAge: age,
        reasons: result.reasons,
      };
}

export function evaluateClassCatalogueEligibility(
  viewer: CatalogueViewer,
  range: NullableAgeRange,
  evaluationDate: IsoDate,
): CatalogueEligibility {
  return evaluateCatalogueAge(viewer, range, evaluationDate);
}

export function evaluateScheduleCatalogueEligibility(
  viewer: CatalogueViewer,
  range: NullableAgeRange,
  occurrenceDate: IsoDate,
): CatalogueEligibility {
  return evaluateCatalogueAge(viewer, range, occurrenceDate);
}

export function evaluatePackageCatalogueEligibility(
  viewer: CatalogueViewer,
  range: NullableAgeRange,
  evaluationDate: IsoDate = getCairoBusinessDate(),
): CatalogueEligibility {
  return evaluateCatalogueAge(viewer, range, evaluationDate);
}

export function studentCatalogueVisible(eligibility: CatalogueEligibility): boolean {
  if (eligibility.evaluated !== true || eligibility.eligible !== false) return true;
  return eligibility.reasons.some((reason) =>
    reason.code === "DOB_REQUIRED" || reason.code === "DOB_INVALID" || reason.code === "DOB_FUTURE",
  );
}
