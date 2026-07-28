import type { AgeRange, EligibilityResult } from "@workspace/api-zod";

const MAX_SUPPORTED_AGE = 150;

export function validateAgeRange(range: AgeRange): EligibilityResult {
  const invalid = (message: string): EligibilityResult => ({
    eligible: false,
    reasons: [{ code: "AGE_RANGE_INVALID", message }],
  });

  if (range.allowAllAges) {
    return range.minAge == null && range.maxAge == null
      ? { eligible: true, warnings: [] }
      : invalid("All Ages cannot define a minimum or maximum age.");
  }
  if (range.minAge == null) return invalid("A restricted age range requires a minimum age.");
  if (!Number.isInteger(range.minAge) || range.minAge < 0 || range.minAge > MAX_SUPPORTED_AGE) {
    return invalid("Minimum age must be an integer between 0 and 150.");
  }
  if (range.maxAge != null && (!Number.isInteger(range.maxAge) || range.maxAge < 0 || range.maxAge > MAX_SUPPORTED_AGE)) {
    return invalid("Maximum age must be an integer between 0 and 150.");
  }
  if (range.maxAge != null && range.minAge > range.maxAge) {
    return invalid("Minimum age cannot be greater than maximum age.");
  }
  return { eligible: true, warnings: [] };
}

export function evaluateAgeRange(age: number, range: AgeRange): EligibilityResult {
  const valid = validateAgeRange(range);
  if (!valid.eligible) return valid;
  if (range.allowAllAges) return { eligible: true, warnings: [] };
  if (age < range.minAge!) {
    return {
      eligible: false,
      reasons: [{
        code: "AGE_BELOW_MINIMUM",
        message: `Participant must be at least ${range.minAge}.`,
        details: { participantAge: age, minAge: range.minAge },
      }],
    };
  }
  if (range.maxAge != null && age > range.maxAge) {
    return {
      eligible: false,
      reasons: [{
        code: "AGE_ABOVE_MAXIMUM",
        message: `Participant must be ${range.maxAge} or younger.`,
        details: { participantAge: age, maxAge: range.maxAge },
      }],
    };
  }
  return { eligible: true, warnings: [] };
}

export function deriveAgeRangeLabel(range: AgeRange): string {
  const valid = validateAgeRange(range);
  if (!valid.eligible) return "Invalid age range";
  if (range.allowAllAges) return "All Ages";
  if (range.minAge === 5 && range.maxAge === 12) return "Kids";
  if (range.minAge === 13 && range.maxAge === 17) return "Teens";
  if (range.minAge === 18 && range.maxAge == null) return "Adults";
  if (range.minAge === 5 && range.maxAge === 17) return "Kids + Teens";
  if (range.maxAge == null) return `${range.minAge}+`;
  return `${range.minAge}–${range.maxAge}`;
}
