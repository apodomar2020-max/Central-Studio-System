export type {
  AgeRange,
  EligibilityReason,
  EligibilityReasonCode,
  EligibilityResult,
  ParticipantSelection,
  ParticipantType,
} from "@workspace/api-zod";

export type IsoDate = string & { readonly __isoDate: unique symbol };

export type LeapDayPolicy = "february_28" | "march_1";
