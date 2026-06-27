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
