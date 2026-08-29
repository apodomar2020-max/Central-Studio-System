import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View } from "react-native";

const SOURCES = {
  cash: require("@/assets/icons/booking-cash.svg"),
  credit: require("@/assets/icons/booking-credit.svg"),
  online: require("@/assets/icons/booking-online.svg"),
  location: require("@/assets/icons/booking-location.svg"),
  promo: require("@/assets/icons/booking-promo.svg"),
} as const;

export type BookingFlowIconName = keyof typeof SOURCES;

export default function BookingFlowIcon({
  name,
  size = 36,
}: {
  name: BookingFlowIconName;
  size?: number;
}): React.ReactElement {
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <Image
        source={SOURCES[name]}
        style={{ width: size, height: size }}
        contentFit="contain"
        transition={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
