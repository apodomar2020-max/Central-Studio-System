import * as Haptics from "expo-haptics";
import React from "react";
import { ActivityIndicator, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "stage";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  /** Override or extend the button's TouchableOpacity styles. */
  style?: StyleProp<ViewStyle>;
}

export default function AppButton({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  style,
}: AppButtonProps) {
  const c = useColors();

  function handlePress() {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }

  const bgColor = {
    primary: colors.studio.primary,
    secondary: c.secondary,
    ghost: "transparent",
    danger: colors.error,
    stage: colors.stage.primary,
  }[variant];

  const textColor = {
    primary: "#0B0B0F",
    secondary: c.foreground,
    ghost: c.foreground,
    danger: "#FFFFFF",
    stage: "#FFFFFF",
  }[variant];

  const height = { sm: 38, md: 48, lg: 56 }[size];
  const fontSize = { sm: 13, md: 15, lg: 16 }[size];

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.75}
      style={[
        styles.button,
        { backgroundColor: bgColor, height, opacity: disabled ? 0.4 : 1 },
        variant === "ghost" && { borderWidth: 1, borderColor: c.border },
        fullWidth && { width: "100%" },
        style,
      ]}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <View style={styles.content}>
          {icon && <View style={styles.iconWrap}>{icon}</View>}
          <Text style={[styles.label, { color: textColor, fontSize }]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconWrap: {},
  label: {
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
});
