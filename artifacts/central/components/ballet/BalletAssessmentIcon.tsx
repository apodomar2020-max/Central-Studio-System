import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View } from "react-native";

const ICONS = {
  edit: {
    source: require("@/assets/icons/ballet-assessment-edit.svg"),
    width: 21,
    height: 21,
  },
  info: {
    source: require("@/assets/icons/ballet-assessment-info.svg"),
    width: 17,
    height: 17,
  },
  payment: {
    source: require("@/assets/icons/ballet-assessment-payment.svg"),
    width: 31,
    height: 25,
  },
  price: {
    source: require("@/assets/icons/ballet-assessment-price.svg"),
    width: 24,
    height: 24,
  },
  shoes: {
    source: require("@/assets/icons/ballet-assessment-shoes.svg"),
    width: 21,
    height: 32,
  },
} as const;

export type BalletAssessmentIconName = keyof typeof ICONS;

export default function BalletAssessmentIcon({
  name,
  size = 24,
  tintColor,
}: {
  name: BalletAssessmentIconName;
  size?: number;
  tintColor?: string;
}) {
  const icon = ICONS[name];
  const scale = size / Math.max(icon.width, icon.height);
  const width = icon.width * scale;
  const height = icon.height * scale;

  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <Image
        source={icon.source}
        style={{ width, height, tintColor }}
        contentFit="contain"
        transition={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
