import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { DanceCategory } from "@/data/mockData";
import { useColors } from "@/hooks/useColors";

interface CategoryCardProps {
  item: DanceCategory;
  onPress?: () => void;
}

export default function CategoryCard({ item, onPress }: CategoryCardProps) {
  const c = useColors();

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onPress) onPress();
    else router.push({ pathname: "/(tabs)/classes", params: { categoryId: item.id } });
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.8}
      style={[styles.card, { backgroundColor: item.imageColor, borderColor: item.color + "40" }]}
    >
      <View style={[styles.iconWrapper, { backgroundColor: item.color + "22" }]}>
        <Ionicons name={item.icon as any} size={22} color={item.color} />
      </View>
      <Text style={[styles.name, { color: "#FFFFFF" }]} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={[styles.levels, { color: item.color }]}>
        {item.levels[0]}+
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 100,
    height: 108,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginRight: 10,
    justifyContent: "space-between",
  },
  iconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  levels: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
