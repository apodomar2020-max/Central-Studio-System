import type { AgeRange } from "@workspace/api-zod";
import { calculateAgeOnDate, parseIsoDate } from "./dateOnly";
import type { IsoDate } from "./types";
import { evaluateAgeRange } from "./ageRange";

export type ParticipantOccurrenceReason =
  | "ELIGIBLE"
  | "PARTICIPANT_DOB_REQUIRED"
  | "PARTICIPANT_DOB_INVALID"
  | "BELOW_MINIMUM_AGE"
  | "ABOVE_MAXIMUM_AGE"
  | "PARTICIPANT_NOT_ELIGIBLE";

export interface ParticipantOccurrenceEligibility {
  eligible: boolean;
  reasonCode: ParticipantOccurrenceReason;
  ageOnOccurrenceDate: number | null;
}

/**
 * The shared server authority for occurrence-specific participant age
 * eligibility. Callers must supply a canonical DB date_of_birth value and
 * the exact occurrence civil date; display ages and client calculations are
 * intentionally not accepted.
 */
export function evaluateParticipantOnOccurrence(
  dateOfBirth: string | null,
  occurrenceDate: string,
  range: AgeRange,
): ParticipantOccurrenceEligibility {
  if (!dateOfBirth) {
    return { eligible: false, reasonCode: "PARTICIPANT_DOB_REQUIRED", ageOnOccurrenceDate: null };
  }
  const parsed = parseIsoDate(dateOfBirth, { today: occurrenceDate as IsoDate });
  if (!parsed.eligible || !parsed.value) {
    return { eligible: false, reasonCode: "PARTICIPANT_DOB_INVALID", ageOnOccurrenceDate: null };
  }
  const age = calculateAgeOnDate(parsed.value, occurrenceDate as IsoDate);
  const result = evaluateAgeRange(age, range);
  const rangeReason = "reasons" in result ? result.reasons?.[0]?.code : undefined;
  return {
    eligible: result.eligible,
    reasonCode: result.eligible
      ? "ELIGIBLE"
      : rangeReason === "AGE_BELOW_MINIMUM"
        ? "BELOW_MINIMUM_AGE"
        : rangeReason === "AGE_ABOVE_MAXIMUM"
          ? "ABOVE_MAXIMUM_AGE"
          : "PARTICIPANT_NOT_ELIGIBLE",
    ageOnOccurrenceDate: age,
  };
}
