import { router } from "expo-router";

import type { ProfileCompletionStep } from "@/contexts/AppContext";
import { nextStepRoute } from "@/services/authProfile";
import { presentCentralAlert } from "@/providers/CentralAlertProvider";

/**
 * Profile Completion Engine (Phase 4) — shown when an incomplete-profile
 * user attempts a restricted action (booking, package purchase, QR
 * membership, ...). Mirrors utils/authRequired.ts's showAuthRequiredPrompt().
 */
export function showProfileIncompletePrompt(nextStep: ProfileCompletionStep | "done") {
  presentCentralAlert({
    title: "Complete your profile first",
    message: "Finish setting up your profile to unlock this feature.",
    actions: [
      { label: "Complete Profile", tone: "primary", onPress: () => router.push(nextStepRoute(nextStep) as never) },
      { label: "Not Now", tone: "neutral" },
    ],
  });
}
