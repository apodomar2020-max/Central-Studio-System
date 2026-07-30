export const PARTICIPANT_TYPES = ["self", "child"] as const;
export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];

export interface ParticipantSelection {
  participantType: ParticipantType;
  participantChildId?: number | null;
}

export interface AgeRange {
  allowAllAges: boolean;
  minAge: number | null;
  maxAge: number | null;
}

export function deriveAgeRangeLabel(range: AgeRange): string {
  if (range.allowAllAges && range.minAge == null && range.maxAge == null) return "All Ages";
  if (range.minAge === 5 && range.maxAge === 12) return "Kids";
  if (range.minAge === 13 && range.maxAge === 17) return "Teens";
  if (range.minAge === 18 && range.maxAge == null) return "Adults";
  if (range.minAge === 5 && range.maxAge === 17) return "Kids + Teens";
  if (range.minAge == null) return "Not configured";
  if (range.maxAge == null) return `${range.minAge}+`;
  return `${range.minAge}–${range.maxAge}`;
}

export const ELIGIBILITY_REASON_CODES = [
  "PARTICIPANT_REQUIRED",
  "PARTICIPANT_NOT_FOUND",
  "PARTICIPANT_NOT_OWNED",
  "PARTICIPANT_TYPE_INVALID",
  "STUDENT_SELF_ONLY",
  "ACCOUNT_TYPE_REQUIRED",
  "ACCOUNT_TYPE_INVALID",
  "DOB_REQUIRED",
  "PARTICIPANT_DOB_REQUIRED",
  "DOB_INVALID",
  "DOB_FUTURE",
  "PARENT_UNDER_18",
  "AGE_BELOW_MINIMUM",
  "AGE_ABOVE_MAXIMUM",
  "AGE_RANGE_INVALID",
  "CLASS_INACTIVE",
  "CLASS_NOT_ELIGIBLE",
  "PACKAGE_INACTIVE",
  "PACKAGE_NOT_ELIGIBLE",
  "PACKAGE_PARTICIPANT_MISMATCH",
  "PACKAGE_EXPIRED",
  "PACKAGE_NO_CREDITS",
  "PACKAGE_DANCE_TYPE_MISMATCH",
  "SCHEDULE_NOT_PACKAGE_ELIGIBLE",
] as const;

export type EligibilityReasonCode = (typeof ELIGIBILITY_REASON_CODES)[number];

export interface EligibilityReason {
  code: EligibilityReasonCode;
  message: string;
  details?: Readonly<Record<string, string | number | boolean | null>>;
}

export type EligibilityResult<T = undefined> =
  | { eligible: true; value?: T; warnings: EligibilityReason[] }
  | { eligible: false; reasons: EligibilityReason[] };
