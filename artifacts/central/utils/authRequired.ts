import { router } from "expo-router";

import { presentCentralAlert } from "@/providers/CentralAlertProvider";

export function showAuthRequiredPrompt() {
  presentCentralAlert({
    title: "Sign in required",
    message: "Create an account or sign in to continue.",
    actions: [
      { label: "Sign In", tone: "primary", onPress: () => router.push("/auth/login" as never) },
      { label: "Create Account", tone: "primary", onPress: () => router.push("/auth/register" as never) },
      { label: "Continue Browsing", tone: "neutral" },
    ],
  });
}

/** Ballet applications require a Parent account. The user must explicitly
 *  change their account type themselves on the profile screen — no silent/
 *  automatic conversion is performed on their behalf. */
export function showParentAccountRequiredPrompt() {
  presentCentralAlert({
    title: "Parent account required",
    message: "Ballet applications can only be submitted from a Parent account. Update your account type in your profile to continue.",
    actions: [
      { label: "Go to Profile", tone: "primary", onPress: () => router.push("/edit-profile" as never) },
      { label: "Not Now", tone: "neutral" },
    ],
  });
}
