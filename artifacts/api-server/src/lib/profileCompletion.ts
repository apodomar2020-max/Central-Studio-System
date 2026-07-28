/**
 * Profile Completion Engine (Phase 4).
 *
 * Single source of truth for "how complete is this account, and what's
 * next" — replaces the old 3-field (name/phone/accountType) definition that
 * used to be duplicated between routes/auth.ts and routes/socialAuth.ts.
 *
 * Completion percentage/isComplete/nextStep/missing/completed are always
 * DERIVED here from the actual saved fields — nothing about completion
 * state is stored as a precomputed value anywhere. `students.lastCompletionStep`
 * is a separate, best-effort resume hint (not read by this module).
 *
 * Registration flow this encodes:
 *   email → profile → children (parent only) → medical (parent only) → styles → done
 */
import { validateProfileAge } from "./eligibility/profileAgeValidation";

export type CompletionStep = "email" | "profile" | "children" | "medical" | "styles";

export interface ProfileCompletionInput {
  emailVerified: boolean;
  accountType: "student" | "parent" | null;
  name: string | null;
  phone: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  city: string | null;
  nationality: string | null;
  howDidYouHearAboutUs: string | null;
  policiesAcceptedAt: string | null;
  /** Total children linked to this account (parent accounts only). */
  childrenCount: number;
  /** Of those children, how many still have a null (never-reviewed) medicalNotes. */
  childrenMissingMedicalCount: number;
  /** Number of dance_types this account has selected via student_dance_interests. */
  danceInterestCount: number;
}

export interface ProfileCompletion {
  percent: number;
  isComplete: boolean;
  nextStep: CompletionStep | "done";
  missing: string[];
  completed: string[];
}

function isNonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const PROFILE_FIELD_CHECKS = (input: ProfileCompletionInput): [string, boolean][] => {
  const ageValidation = input.dateOfBirth
    ? validateProfileAge({ accountType: input.accountType, dateOfBirth: input.dateOfBirth })
    : null;
  return [
  ["name", isNonEmpty(input.name)],
  ["phone", isNonEmpty(input.phone)],
  ["accountType", input.accountType === "student" || input.accountType === "parent"],
  ["gender", isNonEmpty(input.gender)],
  ["dateOfBirth", isNonEmpty(input.dateOfBirth) && ageValidation?.eligible === true],
  ["city", isNonEmpty(input.city)],
  ["nationality", isNonEmpty(input.nationality)],
  ["howDidYouHearAboutUs", isNonEmpty(input.howDidYouHearAboutUs)],
  ["policiesAccepted", input.policiesAcceptedAt != null],
  ];
};

export function computeProfileCompletion(input: ProfileCompletionInput): ProfileCompletion {
  const isParent = input.accountType === "parent";
  const missing: string[] = [];
  const completed: string[] = [];

  // --- email ---
  if (input.emailVerified) completed.push("email");
  else missing.push("email");

  // --- profile (bundles every Complete-Profile-screen field into one step;
  // while incomplete, list the SPECIFIC missing sub-fields rather than the
  // generic step name, so the UI can point at exactly what's missing) ---
  const missingProfileFields = PROFILE_FIELD_CHECKS(input).filter(([, ok]) => !ok).map(([field]) => field);
  const profileComplete = missingProfileFields.length === 0;
  if (profileComplete) completed.push("profile");
  else missing.push(...missingProfileFields);

  // --- children (parent only) ---
  const childrenComplete = !isParent || input.childrenCount > 0;
  if (isParent) {
    if (childrenComplete) completed.push("children");
    else missing.push("children");
  }

  // --- medical (parent only; reuses children.medicalNotes — an explicit
  // empty string counts as "reviewed, nothing to report", only a null value
  // (never asked) counts as missing) ---
  const medicalComplete = !isParent || (input.childrenCount > 0 && input.childrenMissingMedicalCount === 0);
  if (isParent) {
    if (medicalComplete) completed.push("medical");
    else missing.push("medical");
  }

  // --- styles ("Your Vibe") ---
  const stylesComplete = input.danceInterestCount > 0;
  if (stylesComplete) completed.push("styles");
  else missing.push("styles");

  const applicableSteps = isParent ? 5 : 3; // email, profile, [children, medical], styles
  const completedCount =
    (input.emailVerified ? 1 : 0) +
    (profileComplete ? 1 : 0) +
    (isParent ? (childrenComplete ? 1 : 0) + (medicalComplete ? 1 : 0) : 0) +
    (stylesComplete ? 1 : 0);
  const percent = Math.round((completedCount / applicableSteps) * 100);

  const isComplete = input.emailVerified && profileComplete && childrenComplete && medicalComplete && stylesComplete;

  let nextStep: CompletionStep | "done" = "done";
  if (!input.emailVerified) nextStep = "email";
  else if (!profileComplete) nextStep = "profile";
  else if (isParent && !childrenComplete) nextStep = "children";
  else if (isParent && !medicalComplete) nextStep = "medical";
  else if (!stylesComplete) nextStep = "styles";

  return { percent, isComplete, nextStep, missing, completed };
}
