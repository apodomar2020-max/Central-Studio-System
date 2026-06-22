import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity } from "react-native";

/**
 * Apple Sign-In button — design parity with the redesign's Apple option on the
 * welcome screen. Rendered on iOS only, per Apple's Human Interface Guidelines
 * (black button, white Apple mark, "Continue with Apple").
 *
 * Auth is NOT wired yet: there is no `expo-apple-authentication` module or
 * backend `apple` provider. By default this shows an informative notice. To
 * enable real Sign in with Apple later:
 *   1. `npx expo install expo-apple-authentication`
 *   2. add a `useAppleSignIn` hook mirroring useGoogleSignIn (request the
 *      identity token via AppleAuthentication.signInAsync)
 *   3. add a backend `/api/auth/apple` endpoint that verifies the token
 *   4. pass that hook's handler in as `onPress`.
 */
export default function AppleSignInButton({
  onPress,
  loading = false,
  disabled = false,
}: {
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  // Sign in with Apple is an iOS-only affordance.
  if (Platform.OS !== "ios") return null;

  function handlePress() {
    if (onPress) {
      onPress();
      return;
    }
    Alert.alert(
      "Coming soon",
      "Sign in with Apple is on the way. For now, please use Google, Facebook, or email.",
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[styles.button, (disabled || loading) && styles.buttonDisabled]}
      accessibilityRole="button"
      accessibilityLabel="Continue with Apple"
    >
      {loading ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Ionicons name="logo-apple" size={19} color="#FFFFFF" />
      )}
      <Text style={styles.label}>Continue with Apple</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: "100%",
    height: 50,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#000000",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  buttonDisabled: { opacity: 0.6 },
  label: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 15 },
});
