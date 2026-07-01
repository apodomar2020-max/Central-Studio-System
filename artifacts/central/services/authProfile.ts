import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { customFetch } from "@workspace/api-client-react";

import type { User } from "@/contexts/AppContext";

/**
 * New 5-step onboarding flow (post-registration):
 *   1. /auth/register         → Create Account
 *   2. /auth/complete-profile → Complete Client Profile (phone, accountType, DOB*, city*, nationality*)
 *   3. /onboarding/styles     → Your Vibe / Dance Styles
 *   4. /auth/verify-phone     → Verification (email-based, SMS not yet active)
 *   5. /onboarding/success    → You're in!
 *
 * Registration screens route through the onboarding steps explicitly. Login
 * routing is based on the server-authenticated user's verification/profile state.
 *
 * * = Stored locally in AsyncStorage only — backend columns pending:
 *       students.date_of_birth, students.city, students.nationality
 */
export async function enterApp() {
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
  profileCompleted?: boolean;
  profileMissingFields?: string[];
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
) {
  if (accessToken) {
    await AsyncStorage.setItem("studentToken", accessToken);
  }

  const { user, requiresOtp } = await fetchCurrentUser();
  await setUser(user);

  if (requiresOtp || !user.emailVerified) {
    router.push("/verify-email" as never);
    return;
  }

  if (!user.profileCompleted) {
    // Route to Step 2 of the new flow (complete-profile).
    // After saving phone + accountType, complete-profile routes to /onboarding/styles.
    router.push("/auth/complete-profile" as never);
    return;
  }

  await enterApp();
}
