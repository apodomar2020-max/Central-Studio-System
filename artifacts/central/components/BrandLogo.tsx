import React from "react";
import { StyleSheet, Text, View } from "react-native";

import colors from "@/constants/colors";

interface BrandLogoProps {
  size?: "sm" | "md" | "lg";
  mode?: "studio" | "stage" | "both";
  showTagline?: boolean;
}

export default function BrandLogo({
  size = "md",
  mode = "both",
  showTagline = false,
}: BrandLogoProps) {
  const scales = { sm: 0.65, md: 1, lg: 1.4 };
  const s = scales[size];

  const accent =
    mode === "stage" ? colors.stage.primary : colors.studio.primary;

  return (
    <View style={styles.container}>
      <View style={styles.wordmark}>
        <Text
          style={[
            styles.central,
            { fontSize: Math.round(38 * s), letterSpacing: Math.round(6 * s) },
          ]}
        >
          CENTRAL
        </Text>
        <Text
          style={[
            styles.sub,
            {
              fontSize: Math.round(38 * s),
              letterSpacing: Math.round(4 * s),
              color: accent,
            },
          ]}
        >
          {mode === "stage" ? "STAGE" : mode === "both" ? "STUDIO" : "STUDIO"}
        </Text>
      </View>
      {showTagline && mode === "both" && (
        <Text style={[styles.tagline, { fontSize: Math.round(11 * s) }]}>
          Studio · Stage
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 2 },
  wordmark: { alignItems: "flex-start", gap: 0 },
  central: {
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    lineHeight: undefined,
    includeFontPadding: false,
  },
  sub: {
    fontFamily: "Inter_700Bold",
    marginTop: -4,
    includeFontPadding: false,
  },
  tagline: {
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginTop: 6,
  },
});
