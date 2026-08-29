import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View } from "react-native";

const SOURCES = {
  bell: require("@/assets/icons/booking-success-bell.svg"),
  calendar: require("@/assets/icons/booking-success-calendar.svg"),
  home: require("@/assets/icons/booking-success-home.svg"),
} as const;

export type BookingSuccessActionIconName = keyof typeof SOURCES;

export default function BookingSuccessActionIcon({
  name,
  size = 22,
}: {
  name: BookingSuccessActionIconName;
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
