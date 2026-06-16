/**
 * Offline / no-network state component.
 * Show this when a network error (TypeError) is detected — i.e., the device can't reach the server.
 */
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import colors from "@/constants/colors";

interface OfflineStateProps {
  /** Called when the user taps "Try Again" */
  onRetry?: () => void;
  /** "full" fills the available space; "compact" is a small inline banner */
  variant?: "full" | "compact";
  message?: string;
}

export default function OfflineState({
  onRetry,
  variant = "full",
  message = "No internet connection. Check your network and try again.",
}: OfflineStateProps) {
  if (variant === "compact") {
    return (
      <View style={styles.compactContainer}>
        <Ionicons name="wifi-outline" size={16} color="#9CA3AF" />
        <Text style={styles.compactText}>{message}</Text>
        {onRetry && (
          <TouchableOpacity onPress={onRetry} style={styles.compactRetry}>
            <Text style={[styles.compactRetryText, { color: colors.studio.primary }]}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.fullContainer}>
      <View style={styles.iconCircle}>
        <Ionicons name="wifi-outline" size={36} color="#6B7280" />
      </View>
      <Text style={styles.title}>You're offline</Text>
      <Text style={styles.subtitle}>{message}</Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={[styles.retryBtn, { backgroundColor: colors.studio.primary + "20", borderColor: colors.studio.primary + "50" }]}>
          <Ionicons name="refresh-outline" size={16} color={colors.studio.primary} />
          <Text style={[styles.retryText, { color: colors.studio.primary }]}>Try Again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fullContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 14,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#1E1E26",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 21,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  retryText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  // compact variant
  compactContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#1E1E26",
    borderRadius: 10,
    marginHorizontal: 20,
    marginTop: 8,
  },
  compactText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
  },
  compactRetry: {
    paddingHorizontal: 6,
  },
  compactRetryText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
