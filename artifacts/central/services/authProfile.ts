import { router } from "expo-router";
import { customFetch } from "@workspace/api-client-react";

import type { ProfileCompletion, ProfileCompletionStep, User } from "@/contexts/AppContext";
import { setStudentToken } from "@/services/secureTokenStorage";

/**
 * Profile Completion Engine (Phase 4) — registration flow:
 *   1. /auth/register         → Create Account
 *   2. /verify-email          → Email verification (manual signups only;
 *                                Google/Facebook skip straight to step 3)
 *   3. /auth/complete-profile → Complete Profile (phone, accountType, gender,
 *                                DOB, city, nationality, how did you hear, policies)
 *   4. /onboarding/children    → Children (parent accounts only)
 *   5. /onboarding/medical     → Medical Information (parent accounts only)
 *   6. /onboarding/styles      → Your Vibe / Dance Styles
 *   7. /onboarding/success     → Thanks page — the funnel's terminal screen
 *
 * The backend is the single source of truth for what's next — see
 * `nextStepRoute()`. Nothing in the mobile app should hardcode
 * "if profileCompleted" style branching anymore; every routing decision
 * reads `user.profileCompletion.nextStep` instead.
 */

/**
 * Maps a backend-reported step to its screen. The ONLY place this mapping
 * exists — index.tsx, continueAfterAuth(), and verify-email.tsx all call
 * this instead of each hardcoding their own copy.
 */
export function nextStepRoute(nextStep: ProfileCompletionStep | "done"): string {
  switch (nextStep) {
    case "email": return "/verify-email";
    case "profile": return "/auth/complete-profile";
    case "children": return "/onboarding/children";
    case "medical": return "/onboarding/medical";
    case "styles": return "/onboarding/styles";
    case "done": return "/(tabs)";
  }
}

export type AuthSource = "email-login" | "email-signup" | "social-login" | "social-signup" | "session";

export function postAuthDestination(user: User): string {
  if (!user.emailVerified) {
    return "/verify-email";
  }

  const nextStep = user.profileCompletion?.nextStep;
  if (nextStep && nextStep !== "done") {
    return nextStepRoute(nextStep);
  }

  return "/";
}

export function routeAfterAuth(user: User) {
  const destination = postAuthDestination(user);
  if (__DEV__) {
    console.log("[AUTH_NAV] routeAfterAuth", {
      userId: user.id,
      email: user.email,
      authProvider: user.authProvider,
      emailVerified: user.emailVerified,
      nextStep: user.profileCompletion?.nextStep ?? null,
      destination,
    });
  }
  router.replace(destination as never);
}

/**
 * Single shared exit point out of auth/onboarding. Every screen that finishes
 * its job (login, OTP verify, the Thanks page, ...) calls this instead of
 * hardcoding a destination — it just hands control back to the root index
 * redirect (app/index.tsx), which is the one place that decides where the
 * user actually goes based on their server-authenticated state.
 */
export async function enterApp() {
  if (__DEV__) {
    console.log("[AUTH_NAV] enterApp", { destination: "/" });
  }
  router.replace("/" as never);
}

export type AccountType = "student" | "parent";

export interface AuthStudent {
  id: number | string;
  name: string;
  email: string;
  phone?: string | null;
  accountType?: AccountType | null;
  emailVerified?: boolean;
  authProvider?: string | null;
  avatarUrl?: string | null;
  providerDisplayName?: string | null;
  /** @deprecated old 3-field definition — see profileCompletion instead. */
  profileCompleted?: boolean;
  /** @deprecated old 3-field definition — see profileCompletion instead. */
  profileMissingFields?: string[];
  gender?: string | null;
  dateOfBirth?: string | null;
  city?: string | null;
  nationality?: string | null;
  howDidYouHearAboutUs?: string | null;
  policiesAcceptedAt?: string | null;
  profileCompletion?: ProfileCompletion;
  qrToken?: string | null;
}

interface MeResponse {
  student: AuthStudent;
  requiresOtp?: boolean;
}

export function mapStudentToUser(student: AuthStudent): User {
  const accountType = student.accountType ?? undefined;
  return {
    id: String(student.id),
    fullName: student.name ?? "",
    phone: student.phone ?? "",
    email: student.email ?? "",
    emailVerified: student.emailVerified ?? false,
    role: accountType ?? "student",
    accountType,
    authProvider: student.authProvider ?? null,
    providerDisplayName: student.providerDisplayName ?? null,
    profileCompleted: student.profileCompleted ?? false,
    profileMissingFields: student.profileMissingFields ?? [],
    gender: student.gender ?? null,
    dateOfBirth: student.dateOfBirth ?? null,
    city: student.city ?? null,
    nationality: student.nationality ?? null,
    howDidYouHearAboutUs: student.howDidYouHearAboutUs ?? null,
    policiesAcceptedAt: student.policiesAcceptedAt ?? null,
    profileCompletion: student.profileCompletion,
    qrToken: student.qrToken ?? undefined,
    avatarUrl: student.avatarUrl ?? undefined,
  };
}

export async function fetchCurrentUser(): Promise<{ user: User; requiresOtp: boolean }> {
  const data = await customFetch<MeResponse>("/api/auth/me");
  return {
    user: mapStudentToUser(data.student),
    requiresOtp: !!data.requiresOtp,
  };
}

export async function continueAfterAuth(
  accessToken: string | undefined,
  setUser: (user: User | null) => Promise<void>,
  options?: { guidedOnboarding?: boolean; source?: AuthSource },
) {
  if (__DEV__) {
    console.log("[AUTH_NAV] continueAfterAuth start", {
      source: options?.source ?? "unspecified",
      guidedOnboarding: !!options?.guidedOnboarding,
      hasAccessToken: !!accessToken,
    });
  }

  if (accessToken) {
    // Security Wave — Mobile SecureStore / Privacy Hardening: the Student
    // JWT lives only in SecureStore now — see services/secureTokenStorage.ts.
    await setStudentToken(accessToken);
  }

  const { user } = await fetchCurrentUser();
  if (__DEV__) {
    console.log("[AUTH_NAV] continueAfterAuth fetchedUser", {
      userId: user.id,
      email: user.email,
      authProvider: user.authProvider,
      emailVerified: user.emailVerified,
      nextStep: user.profileCompletion?.nextStep ?? null,
      destination: postAuthDestination(user),
    });
  }
  await setUser(user);

  routeAfterAuth(user);
}
