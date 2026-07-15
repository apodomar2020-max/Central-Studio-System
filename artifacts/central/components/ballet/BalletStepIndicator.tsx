import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { BA } from "./assessmentTokens";

const STEP_LABELS = ["Child", "Date", "Package", "Review"];

export default function BalletStepIndicator({ currentIndex }: { currentIndex: number }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {STEP_LABELS.map((label, index) => {
          const isActive = index === currentIndex;
          const isDone = index < currentIndex;
          const on = isActive || isDone;
          return (
            <React.Fragment key={label}>
              <View style={styles.step}>
                <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>{label}</Text>
                <View style={[styles.dot, on && styles.dotOn]} />
              </View>
              {index < STEP_LABELS.length - 1 && <View style={[styles.line, isDone && styles.lineOn]} />}
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  step: {
    alignItems: "center",
    gap: 6,
    minWidth: 46,
  },
  label: {
    color: BA.ink400,
    fontFamily: "SpaceMono_700Bold",
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  labelOn: { color: BA.cyan400 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: BA.ink900,
  },
  dotOn: {
    borderColor: BA.cyan500,
    backgroundColor: BA.cyan500,
  },
  line: {
    flex: 1,
    height: 1,
    marginBottom: 5,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  lineOn: { backgroundColor: "rgba(0,182,215,0.65)" },
});
