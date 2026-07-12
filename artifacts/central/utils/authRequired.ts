import { Alert } from "react-native";
import { router } from "expo-router";

export function showAuthRequiredPrompt() {
  Alert.alert(
    "Sign in required",
    "Create an account or sign in to continue.",
    [
      { text: "Sign In", onPress: () => router.push("/auth/login" as never) },
      { text: "Create Account", onPress: () => router.push("/auth/register" as never) },
      { text: "Continue Browsing", style: "cancel" },
    ],
  );
}

/** Ballet applications require a Parent account. The user must explicitly
 *  change their account type themselves on the profile screen — no silent/
 *  automatic conversion is performed on their behalf. */
export function showParentAccountRequiredPrompt() {
  Alert.alert(
    "Parent account required",
    "Ballet applications can only be submitted from a Parent account. Update your account type in your profile to continue.",
    [
      { text: "Go to Profile", onPress: () => router.push("/edit-profile" as never) },
      { text: "Not Now", style: "cancel" },
    ],
  );
}
