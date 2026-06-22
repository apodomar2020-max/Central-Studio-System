import React from "react";
import { StyleSheet, View } from "react-native";

import colors from "@/constants/colors";

/**
 * Signup/onboarding progress dots — design parity with the redesign's
 * `ProgressDots` primitive. Active dot stretches to a 20px cyan pill,
 * completed dots are dim cyan, upcoming dots are faint white.
 */
export default function ProgressDots({
  total,
  current,
}: {
  total: number;
  /** zero-based index of the active step */
  current: number;
}) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === current
              ? styles.active
              : i < current
                ? styles.done
                : styles.upcoming,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  active: { width: 20, backgroundColor: colors.cyan },
  done: { backgroundColor: "rgba(0,182,215,0.45)" },
  upcoming: { backgroundColor: "rgba(255,255,255,0.15)" },
});
