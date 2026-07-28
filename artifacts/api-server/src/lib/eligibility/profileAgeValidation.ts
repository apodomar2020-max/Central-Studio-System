import type { EligibilityResult } from "@workspace/api-zod";
import { calculateAgeOnDate, getCairoBusinessDate, parseIsoDate } from "./dateOnly";
import type { IsoDate } from "./types";

export type ProfileAccountType = "student" | "parent" | null;

export function validateProfileAge(input: {
  accountType: ProfileAccountType | string;
  dateOfBirth: string | null | undefined;
  evaluationDate?: IsoDate;
}): EligibilityResult<{ dateOfBirth: IsoDate; age: number }> {
  if (input.accountType !== "student" && input.accountType !== "parent" && input.accountType != null) {
    return { eligible: false, reasons: [{ code: "ACCOUNT_TYPE_INVALID", message: "Account type must be student or parent." }] };
  }
  if (input.dateOfBirth == null || input.dateOfBirth.trim() === "") {
    return { eligible: false, reasons: [{ code: "DOB_REQUIRED", message: "Date of birth is required." }] };
  }
  const evaluationDate = input.evaluationDate ?? getCairoBusinessDate();
  const parsed = parseIsoDate(input.dateOfBirth, { today: evaluationDate });
  if (!parsed.eligible) return { eligible: false, reasons: parsed.reasons };
  if (!parsed.value) {
    return { eligible: false, reasons: [{ code: "DOB_INVALID", message: "Date of birth is invalid." }] };
  }
  const age = calculateAgeOnDate(parsed.value, evaluationDate);
  if (input.accountType === "parent" && age < 18) {
    return {
      eligible: false,
      reasons: [{
        code: "PARENT_UNDER_18",
        message: "Parent account holders must be at least 18 years old.",
        details: { participantAge: age, minAge: 18 },
      }],
    };
  }
  return { eligible: true, value: { dateOfBirth: parsed.value, age }, warnings: [] };
}
