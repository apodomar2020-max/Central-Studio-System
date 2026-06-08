import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import colors from "@/constants/colors";

interface Props {
  onDismiss: () => void;
}

export default function NewStudentBanner({ onDismiss }: Props) {
  return (
    <View style={styles.wrapper}>
      <LinearGradient
        colors={["#003A47", "#001E28"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.container}
      >
        <View style={[styles.accentBar, { backgroundColor: colors.studio.primary }]} />

        <View style={styles.inner}>
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>NEW MEMBER</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onDismiss();
              }}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              style={styles.dismissBtn}
            >
              <Ionicons name="close" size={16} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <View style={styles.contentRow}>
            <View style={styles.textBlock}>
              <Text style={styles.headline}>
                Your First Class Is{" "}
                <Text style={{ color: colors.studio.primary }}>FREE 🎉</Text>
              </Text>
              <Text style={styles.description}>
                New Member Welcome offer — 100% off your first booking. No strings attached.
              </Text>
            </View>

            <View style={[styles.discountBubble, { borderColor: colors.studio.primary + "40" }]}>
              <Text style={[styles.discountPct, { color: colors.studio.primary }]}>100%</Text>
              <Text style={styles.discountOff}>OFF</Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/(tabs)/classes");
            }}
            activeOpacity={0.85}
            style={[styles.ctaBtn, { backgroundColor: colors.studio.primary }]}
          >
            <Text style={styles.ctaBtnText}>Book Your Free Class</Text>
            <Ionicons name="arrow-forward" size={15} color="#000" />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 20,
    marginBottom: 28,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.studio.primary + "30",
  },
  container: { flexDirection: "row" },
  accentBar: { width: 4 },
  inner: { flex: 1, padding: 16, gap: 10 },
  badgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#04a4c2",
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#000",
    letterSpacing: 0.8,
  },
  dismissBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FFFFFF0F",
    alignItems: "center",
    justifyContent: "center",
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  textBlock: { flex: 1, gap: 4 },
  headline: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    lineHeight: 22,
  },
  description: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    lineHeight: 17,
  },
  discountBubble: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.studio.primary + "12",
  },
  discountPct: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    lineHeight: 18,
  },
  discountOff: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#9CA3AF",
    letterSpacing: 1,
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: 10,
  },
  ctaBtnText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#000",
  },
});
