import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";

/**
 * Facebook Sign-In button. Presentational only — the auth flow lives in
 * useFacebookSignIn(); pass its `onPress`, `loading`, and `disabled` here.
 */
export default function FacebookSignInButton({
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
      accessibilityLabel="Continue with Facebook"
    >
      {loading ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Ionicons name="logo-facebook" size={18} color="#FFFFFF" />
      )}
      <Text style={styles.label}>Continue with Facebook</Text>
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
    backgroundColor: "#1877F2",
  },
  buttonDisabled: { opacity: 0.6 },
  label: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
