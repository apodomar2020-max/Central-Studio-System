import { router } from "expo-router";
import React from "react";
import { StyleProp, StyleSheet, TouchableOpacity, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

type CentralBackButtonProps = {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  activeOpacity?: number;
};

export function CentralBackIcon() {
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34" fill="none">
      <Path
        d="M19.0839 12.1125L14.4968 16.6607L19.0839 21.2089"
        stroke="white"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M32.0806 16.6607C32.0806 23.8075 32.0806 27.381 29.8413 29.6012C27.6022 31.8214 23.9981 31.8214 16.7903 31.8214C9.58238 31.8214 5.97842 31.8214 3.73922 29.6012C1.5 27.381 1.5 23.8075 1.5 16.6607C1.5 9.51388 1.5 5.94047 3.73922 3.72024C5.97842 1.5 9.58238 1.5 16.7903 1.5C23.9981 1.5 27.6022 1.5 29.8413 3.72024C31.3303 5.1965 31.8292 7.271 31.9964 10.5964"
        stroke="white"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export default function CentralBackButton({
  onPress = () => router.back(),
  style,
  activeOpacity = 0.75,
}: CentralBackButtonProps) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={onPress}
      activeOpacity={activeOpacity}
      hitSlop={8}
      style={[styles.button, style, styles.visualReset]}
    >
      <CentralBackIcon />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  visualReset: {
    padding: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    shadowOpacity: 0,
    elevation: 0,
  },
});
