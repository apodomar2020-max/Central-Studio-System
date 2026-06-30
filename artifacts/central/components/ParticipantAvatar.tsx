import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Svg, { Circle, Path } from "react-native-svg";
import colors from "@/constants/colors";

/**
 * Shared participant avatar — mirrors the avatar logic used on the Profile
 * screen so the account owner and children look identical wherever they appear
 * (Profile, Booking Flow, …).
 *
 *  • Account owner ("self"): Google/Facebook/profile photo (`user.avatarUrl`)
 *    when available, otherwise the same studio-cyan initials circle as Profile.
 *  • Child: the same gender-based figure as Profile —
 *      girl  → pink (#FF2E7E)
 *      boy   → cyan (#00B6D7)
 *      other → neutral grey, no gender mini-symbol.
 */

const GIRL_COLOR = "#FF2E7E";
const BOY_COLOR = "#00B6D7";
const NEUTRAL_COLOR = "#8E97A2";

type ParticipantAvatarProps =
  | { type: "self"; name: string; avatarUrl?: string | null; size?: number }
  | { type: "child"; name: string; gender?: string | null; size?: number };

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export default function ParticipantAvatar(props: ParticipantAvatarProps): React.ReactElement {
  const size = props.size ?? 44;
  const radius = size / 2;

  if (props.type === "self") {
    if (props.avatarUrl) {
      return (
        <Image
          source={{ uri: props.avatarUrl }}
          style={{ width: size, height: size, borderRadius: radius, backgroundColor: "#1E1E26" }}
          contentFit="cover"
          transition={150}
        />
      );
    }
    return (
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: radius, backgroundColor: colors.studio.primary + "30" },
        ]}
      >
        <Text style={{ color: colors.studio.primary, fontFamily: "Archivo_700Bold", fontSize: Math.round(size * 0.36) }}>
          {initialsOf(props.name)}
        </Text>
      </View>
    );
  }

  // Child — gender-based figure (matches Profile's ChildCard avatar).
  const known = props.gender === "female" || props.gender === "male";
  const isGirl = props.gender === "female";
  const genderColor = !known ? NEUTRAL_COLOR : isGirl ? GIRL_COLOR : BOY_COLOR;
  const figureSp = {
    stroke: genderColor,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  const fig = Math.round(size * 0.58);

  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: genderColor + "15",
          borderWidth: 1.5,
          borderColor: genderColor,
        },
      ]}
    >
      <Svg width={fig} height={fig} viewBox="0 0 24 24">
        <Circle cx={12} cy={8} r={4} {...figureSp} />
        <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" {...figureSp} />
        {known &&
          (isGirl ? (
            <Path d="M12 16v5M9.5 18.5h5" {...figureSp} />
          ) : (
            <Path d="M17 3h4v4M17 7l4-4" {...figureSp} />
          ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
});
