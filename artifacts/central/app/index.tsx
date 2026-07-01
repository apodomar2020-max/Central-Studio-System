import { useEffect } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useAppContext } from "@/contexts/AppContext";

export default function IndexScreen() {
  const { isLoading, user } = useAppContext();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      // Unauthenticated → design Welcome landing (offers Sign Up + Sign In).
      router.replace("/onboarding/welcome");
      return;
    }
    // Email verification remains a hard gate everywhere (security
    // requirement, not a "nice to complete" onboarding step).
    if (!user.emailVerified) {
      router.replace("/verify-email" as never);
      return;
    }
    // Profile Completion Engine (Phase 4): existing/returning users are
    // NEVER routed back into onboarding on a cold app launch just because
    // some profile step is incomplete — they go straight to Home, where the
    // completion banner (and per-action restrictions on booking/package/QR)
    // take over. The full guided step-by-step sequence only runs right after
    // register/login/social-auth, via continueAfterAuth() in authProfile.ts —
    // never here.
    router.replace("/(tabs)" as never);
  }, [isLoading, user]);

  return <View style={{ flex: 1, backgroundColor: "#060C10" }} />;
}
