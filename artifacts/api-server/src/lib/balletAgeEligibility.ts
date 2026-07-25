import { isValidIsoDate } from "./occurrence";

/**
 * Computes age in whole completed years as of `referenceDateIso` (YYYY-MM-DD),
 * NOT as of today — used to check assessment-slot age eligibility against the
 * child's age on the slot's actual date. Returns null if either date string is
 * not a valid calendar date.
 */
export function computeAgeAsOf(birthdayIso: string, referenceDateIso: string): number | null {
  if (!isValidIsoDate(birthdayIso) || !isValidIsoDate(referenceDateIso)) return null;
  const birth = new Date(`${birthdayIso}T00:00:00Z`);
  const ref = new Date(`${referenceDateIso}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(ref.getTime())) return null;

  let age = ref.getUTCFullYear() - birth.getUTCFullYear();
  const refMonthDay = ref.getUTCMonth() * 100 + ref.getUTCDate();
  const birthMonthDay = birth.getUTCMonth() * 100 + birth.getUTCDate();
  if (refMonthDay < birthMonthDay) age -= 1;
  return age;
}

/**
 * Checks inclusive age eligibility against level ageMin and ageMax for completedAge.
 */
export function isAgeEligible(
  completedAge: number,
  ageMin: number | null,
  ageMax: number | null,
): boolean {
  if (ageMin != null && completedAge < ageMin) return false;
  if (ageMax != null && completedAge > ageMax) return false;
  return true;
}
