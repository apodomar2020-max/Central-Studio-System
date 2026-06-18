import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";

/**
 * Google Sign-In button. Presentational only — the auth flow lives in
 * useGoogleSignIn(); pass its `onPress`, `loading`, and `disabled` here.
 */
export default function GoogleSignInButton({
  onPress,
  loading = false,
  disabled = false,
}: {
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[styles.button, (disabled || loading) && styles.buttonDisabled]}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
    >
      {loading ? (
        <ActivityIndicator size="small" color="#3C4043" />
      ) : (
        <Ionicons name="logo-google" size={18} color="#EA4335" />
      )}
      <Text style={styles.label}>Continue with Google</Text>
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
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DADCE0",
  },
  buttonDisabled: { opacity: 0.6 },
  label: { color: "#3C4043", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
