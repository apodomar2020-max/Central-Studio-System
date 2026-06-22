import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Image, Text, View } from "react-native";
import { SvgUri, SvgXml } from "react-native-svg";

/**
 * Dance-style category icon — fully backend-driven (CMS Dance Types).
 * Resolution order:
 *   1. inline sanitized `iconSvg` (from API)  → <SvgXml>
 *   2. `iconUrl` ending in .svg                → <SvgUri>
 *   3. `iconUrl` image (png/jpg/…)             → <Image>
 *   4. `legacyIcon` Ionicons name              → migration fallback only
 *   5. first letter of the name                → final fallback
 * No dance styles or icons are hardcoded here.
 */
export default function CategoryIcon({
  iconSvg,
  iconUrl,
  legacyIcon,
  name,
  color,
  size = 22,
}: {
  iconSvg?: string | null;
  iconUrl?: string | null;
  /** Ionicons name used only when falling back to legacy hardcoded categories. */
  legacyIcon?: string | null;
  name: string;
  /** Resolved icon color (used for the legacy Ionicon + first-letter fallback). */
  color: string;
  size?: number;
}) {
  if (iconSvg) {
    return <SvgXml xml={iconSvg} width={size} height={size} />;
  }
  if (iconUrl && /\.svg(\?|#|$)/i.test(iconUrl)) {
    return <SvgUri uri={iconUrl} width={size} height={size} />;
  }
  if (iconUrl) {
    return <Image source={{ uri: iconUrl }} style={{ width: size, height: size }} resizeMode="contain" />;
  }
  if (legacyIcon) {
    return <Ionicons name={legacyIcon as any} size={size} color={color} />;
  }
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: "Archivo_800ExtraBold", fontSize: Math.round(size * 0.62), color }}>
        {(name?.trim()?.[0] ?? "?").toUpperCase()}
      </Text>
    </View>
  );
}
