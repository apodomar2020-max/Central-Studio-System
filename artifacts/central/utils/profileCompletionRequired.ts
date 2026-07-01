import { Alert } from "react-native";
import { router } from "expo-router";

import type { ProfileCompletionStep } from "@/contexts/AppContext";
import { nextStepRoute } from "@/services/authProfile";

/**
 * Profile Completion Engine (Phase 4) — shown when an incomplete-profile
 * user attempts a restricted action (booking, package purchase, QR
 * membership, ...). Mirrors utils/authRequired.ts's showAuthRequiredPrompt().
 */
export function showProfileIncompletePrompt(nextStep: ProfileCompletionStep | "done") {
  Alert.alert(
    "Complete your profile first",
    "Finish setting up your profile to unlock this feature.",
    [
      { text: "Complete Profile", onPress: () => router.push(nextStepRoute(nextStep) as never) },
      { text: "Not Now", style: "cancel" },
    ],
  );
}
