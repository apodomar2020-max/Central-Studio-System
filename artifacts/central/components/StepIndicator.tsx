import React from "react";
import { StyleSheet, Text, View } from "react-native";
import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";

interface StepIndicatorProps {
  current: number;
  total: number;
  labels?: string[];
  mode?: "studio" | "stage";
}

export default function StepIndicator({ current, total, labels, mode = "studio" }: StepIndicatorProps) {
  const c = useColors();
  const accent = mode === "stage" ? colors.stage.primary : colors.studio.primary;

  return (
    <View style={styles.container}>
      <View style={styles.stepsRow}>
        {Array.from({ length: total }).map((_, i) => {
          const isActive = i < current;
          const isCurrent = i === current - 1;
          return (
            <React.Fragment key={i}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: isActive ? accent : c.secondary,
                    borderColor: isCurrent ? accent : "transparent",
                    width: isCurrent ? 28 : 8,
                  },
                ]}
              />
              {i < total - 1 && (
                <View style={[styles.line, { backgroundColor: i < current - 1 ? accent : c.secondary }]} />
              )}
            </React.Fragment>
          );
        })}
      </View>
      <Text style={[styles.label, { color: c.mutedForeground }]}>
        Step {current} of {total}{labels ? ` — ${labels[current - 1]}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 8, paddingVertical: 8 },
  stepsRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: {
    height: 8,
    borderRadius: 4,
    borderWidth: 0,
  },
  line: { flex: 1, height: 2, borderRadius: 1, minWidth: 20 },
  label: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
