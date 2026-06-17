import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";

interface Offer {
  color: string;
  badge: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  title: string;
  description?: string;
  endDate: string;
}

interface OfferCardProps {
  item: Offer;
  compact?: boolean;
}

export default function OfferCard({ item, compact = false }: OfferCardProps) {
  const c = useColors();

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.85} style={styles.wrapper}>
      <LinearGradient
        colors={[item.color + "33", item.color + "11"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, { borderColor: item.color + "40" }]}
      >
        <View style={styles.topRow}>
          <View style={[styles.badge, { backgroundColor: item.color }]}>
            <Text style={styles.badgeText}>{item.badge}</Text>
          </View>
          <View style={[styles.discountBubble, { backgroundColor: item.color }]}>
            <Text style={styles.discountAmount}>
              {item.discountType === "percentage"
                ? `${item.discountValue === 100 ? "FREE" : `${item.discountValue}% OFF`}`
                : `EGP ${item.discountValue} OFF`}
            </Text>
          </View>
        </View>
        <Text style={[styles.title, { color: "#FFFFFF" }]} numberOfLines={2}>
          {item.title}
        </Text>
        {!compact && (
          <Text style={[styles.description, { color: "#FFFFFF99" }]} numberOfLines={2}>
            {item.description}
          </Text>
        )}
        <Text style={[styles.validity, { color: item.color }]}>
          Valid until {new Date(item.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 12 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#000",
    letterSpacing: 1,
  },
  discountBubble: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  discountAmount: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#000",
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    lineHeight: 24,
  },
  description: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  validity: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
});
