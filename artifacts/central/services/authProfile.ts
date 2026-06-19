import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { customFetch } from "@workspace/api-client-react";

import type { User } from "@/contexts/AppContext";

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
    router.replace("/verify-email" as never);
    return;
  }

  if (!user.profileCompleted) {
    router.replace("/auth/complete-profile" as never);
    return;
  }

  router.replace("/" as never);
}
