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

export const ELIGIBILITY_REASON_CODES = [
  "PARTICIPANT_REQUIRED",
  "PARTICIPANT_NOT_FOUND",
  "PARTICIPANT_NOT_OWNED",
  "PARTICIPANT_TYPE_INVALID",
  "STUDENT_SELF_ONLY",
  "ACCOUNT_TYPE_REQUIRED",
  "ACCOUNT_TYPE_INVALID",
  "DOB_REQUIRED",
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
