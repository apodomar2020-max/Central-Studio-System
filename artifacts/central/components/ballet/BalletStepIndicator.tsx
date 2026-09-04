import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { BA } from "./assessmentTokens";

const STEP_LABELS = ["Child", "Date", "Plan", "Review"];

export default function BalletStepIndicator({ currentIndex }: { currentIndex: number }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        {STEP_LABELS.map((label, index) => {
          const isCurrent = index === currentIndex;
          const isDone = index < currentIndex;
          return (
            <React.Fragment key={label}>
              <View style={styles.step}>
                <View style={[styles.dot, isCurrent && styles.dotCurrent, isDone && styles.dotDone]}>
                  {isDone ? <Ionicons name="checkmark" size={23} color="#FFFFFF" /> : <Text style={styles.bang}>!</Text>}
                </View>
                <Text style={styles.label} numberOfLines={1}>{label}</Text>
              </View>
              {index < STEP_LABELS.length - 1 ? <View style={[styles.line, index < currentIndex && styles.lineDone]} /> : null}
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 430, alignSelf: "center", paddingHorizontal: 36, paddingTop: 4, paddingBottom: 12 },
  track: { flexDirection: "row", alignItems: "flex-start" },
  step: { width: 40, alignItems: "center" },
  dot: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F4F4" },
  dotCurrent: { backgroundColor: "#FFC400" },
  dotDone: { backgroundColor: BA.cyan500 },
  bang: { color: "#101214", fontFamily: "Archivo_500Medium", fontSize: 22, lineHeight: 25 },
  label: { marginTop: 5, color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 12, lineHeight: 15 },
  line: { flex: 1, height: 6, marginHorizontal: -1, marginTop: 17, backgroundColor: "#F3F4F4" },
  lineDone: { backgroundColor: BA.cyan500 },
});
