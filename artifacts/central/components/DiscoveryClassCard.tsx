import { classTagColors, classTagStyles, levelTagColor, ageTagColor } from "@/constants/classTags";
import * as Haptics from "expo-haptics";
import { GlassView } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { pushOnce } from "@/utils/navigation";
import React, { useMemo, useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";
import { PriceTagIcon } from "./PriceTagIcon";
import { ClassCardPresentation, twentyFourHourTime } from "./BookingCard";
import colors from "@/constants/colors";

import type { DanceClass, Instructor } from "@/data/mockData";
import CategoryIcon from "@/components/CategoryIcon";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const CYAN = "#00B6D7";
const INK = "#050607";
const MUTED = "#B6BDC6";
const SUCCESS = "#24C65A";
const AMBER = "#FFB02E";
const DANGER = "#FF3B47";

type Props = {
  item: DanceClass;
  instructor?: Instructor;
  styleIcon?: DiscoveryStyleIcon;
  onSelect?: (item: DanceClass) => void;
  onBook?: (item: DanceClass) => void;
  style?: ViewStyle;
  presentation?: "discovery" | "bookingReference";
};

export type DiscoveryStyleIcon = {
  iconSvg?: string | null;
  iconUrl?: string | null;
  legacyIcon?: string | null;
  color?: string;
};

export { PriceTagIcon } from "./PriceTagIcon";

function classStatus(item: DanceClass) {
  switch (item.status) {
    case "available": return { label: "Available", color: SUCCESS, bg: "rgba(36,198,90,0.24)" };
    case "fewSeats": return { label: "Few Seats", color: AMBER, bg: "rgba(255,176,46,0.22)" };
    case "full": return { label: "Full", color: DANGER, bg: "rgba(255,59,71,0.22)" };
    case "cancelled": return { label: "Cancelled", color: DANGER, bg: "rgba(255,59,71,0.22)" };
    case "unavailable": return { label: "Unavailable", color: MUTED, bg: "rgba(255,255,255,0.12)" };
    default: return { label: "Waitlist", color: AMBER, bg: "rgba(255,176,46,0.22)" };
  }
}

function dateParts(item: DanceClass) {
  const parts = item.date?.split("-").map(Number) ?? [];
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return {
      weekday: (item.dayOfWeek || date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })).toUpperCase(),
      day: String(parts[2]).padStart(2, "0"),
      month: date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase(),
    };
  }
  return { weekday: (item.dayOfWeek || "DATE").toUpperCase(), day: "--", month: "" };
}

function instructorRole(instructor?: Instructor, fallback?: string) {
  const title = instructor?.title?.replace(/\s*Instructor\s*$/i, "").trim();
  return title || fallback || "Instructor";
}

export default function DiscoveryClassCard({ item, instructor, styleIcon, onSelect, style, presentation = "discovery" }: Props) {
  const [failedMediaUri, setFailedMediaUri] = useState<string | null>(null);
  const mediaUri = item.photoUrl?.trim() || null;
  const hasMedia = Boolean(mediaUri && mediaUri !== failedMediaUri);
  const date = useMemo(() => dateParts(item), [item.date, item.dayOfWeek]);
  const status = classStatus(item);

  const openDetails = () => {
    if (onSelect) {
      onSelect(item);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pushOnce({ pathname: "/class/[id]", params: { id: item.id, scheduleId: item.scheduleId } });
  };

  const ageLabel = item.ageRangeLabel || item.ageGroup;

  if (presentation === "bookingReference") {
    return <ClassCardPresentation
      item={{ className: item.title, instructorName: instructor?.name || "Instructor", instructorImage: instructor?.photoUrl, location: item.location, classPhotoUrl: hasMedia ? mediaUri! : undefined }}
      dateLabel={item.date ? `${date.day} ${date.month} ${item.date.slice(0, 4)}` : "DATE TBD"}
      timeLabel={twentyFourHourTime(item.startTime)}
      status={status}
      railLabel={status.label}
      railColor={colors.studio.primary}
      priceLabel={item.price > 0 ? `Walk-In: ${item.price} EGP` : "Walk-In: TBC"}
      onPress={openDetails}
      onImageError={() => setFailedMediaUri(mediaUri)}
      style={style}
      tags={<View style={styles.tags}>
        <View style={[styles.tag, styles.styleTag]}>
              <View pointerEvents="none" style={classTagStyles.danceOutline} />
          <CategoryIcon iconSvg={styleIcon?.iconSvg} iconUrl={styleIcon?.iconUrl} legacyIcon={styleIcon?.legacyIcon} name={item.categoryName} color={styleIcon?.color || CYAN} size={13} />
          <Text style={[styles.tagText, styles.styleTagText]}>{item.categoryName}</Text>
        </View>
        <View style={[styles.tag, { backgroundColor: levelTagColor(item.level) }]}><Text style={styles.tagText}>{item.level}</Text></View>
        <View style={[styles.tag, { backgroundColor: ageTagColor(item.ageGroup) }]}><Text style={styles.tagText}>{ageLabel}</Text></View>
      </View>}
    />;
  }
  return (
    <View style={[styles.rail, style]}>
      <TouchableOpacity style={styles.card} onPress={openDetails} activeOpacity={0.92}>
        <View style={[styles.imageArea, !hasMedia && styles.compactImageArea]}>
          {hasMedia ? (
            <Image key={mediaUri} source={{ uri: mediaUri! }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailedMediaUri(mediaUri)} />
          ) : (
            <LinearGradient colors={["#30343A", "#111316"]} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient
            colors={["rgba(0,0,0,0.02)", "rgba(0,0,0,0.18)", "rgba(5,6,7,0.98)"]}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        <View style={[styles.status, { backgroundColor: status.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: status.color }]} />
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>

        <View style={[styles.infoPanelShell, !hasMedia && styles.compactInfoPanelShell]}>
          <GlassView
            glassEffectStyle="clear"
            tintColor="rgba(3,21,24,0.20)"
            colorScheme="dark"
            pointerEvents="none"
            style={styles.glassBackdrop}
          />

          <View style={styles.infoPanelContent}>
            <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
            <View style={styles.summaryRow}>
              <View style={styles.copyColumn}>
                <Text style={styles.description} numberOfLines={2} ellipsizeMode="tail">{item.description}</Text>
                <View style={styles.instructor}>
                  <View style={styles.avatar}>
                    {instructor?.photoUrl ? (
                      <Image source={{ uri: instructor.photoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    ) : (
                      <Text style={styles.initials}>{instructor?.initials || "?"}</Text>
                    )}
                  </View>
                  <View style={styles.instructorCopy}>
                    <Text style={styles.instructorName}>{instructor?.name || "Instructor"}</Text>
                    <Text style={styles.instructorRole}>{instructorRole(instructor, item.categoryName)}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.dateColumn}>
                <View style={styles.dateBlock}>
                  <Text style={styles.weekday} numberOfLines={1} adjustsFontSizeToFit>{date.weekday}</Text>
                  <View style={styles.dateRow}>
                    <Text style={styles.day}>{date.day}</Text>
                    <Text style={styles.month}>{date.month}</Text>
                  </View>
                </View>
              </View>
            </View>
            <View style={styles.footer}>
              <View style={styles.tags}>
                <View style={[styles.tag, styles.styleTag]}>
              <View pointerEvents="none" style={classTagStyles.danceOutline} />
                  <CategoryIcon
                    iconSvg={styleIcon?.iconSvg}
                    iconUrl={styleIcon?.iconUrl}
                    legacyIcon={styleIcon?.legacyIcon}
                    name={item.categoryName}
                    color={styleIcon?.color || CYAN}
                    size={13}
                  />
                  <Text style={[styles.tagText, styles.styleTagText]}>{item.categoryName}</Text>
                </View>
                <View style={[styles.tag, { backgroundColor: levelTagColor(item.level) }]}>
                  <Text style={styles.tagText}>{item.level}</Text>
                </View>
                <View style={[styles.tag, { backgroundColor: ageTagColor(item.ageGroup) }]}>
                  <Text style={styles.tagText}>{ageLabel}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.priceRail}>
        <PriceTagIcon />
        <Text style={styles.priceRailText}>
          Walk-In Class Price : {item.price > 0 ? `${item.price} EGP` : "TBC"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: "100%",
    backgroundColor: CYAN,
    borderRadius: 18,
    paddingBottom: 28,
    overflow: "hidden",
  },
  card: {
    paddingBottom: 10,
    backgroundColor: INK,
    borderRadius: 18,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.45,
    shadowRadius: 9,
    elevation: 7,
    zIndex: 2,
  },
  imageArea: { height: 174, width: "100%", backgroundColor: "#17191D" },
  // Keep a small status/header band when there is no usable artwork.
  compactImageArea: { height: 64 },
  compactInfoPanelShell: { marginTop: -16 },
  status: {
    position: "absolute",
    top: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 9, fontFamily: "Archivo_700Bold" },
  infoPanelShell: {
    marginHorizontal: 12,
    marginTop: -44,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  infoPanelContent: {
    width: "100%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "transparent",
  },
  glassBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(1,8,10,0.48)",
  },
  summaryRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  copyColumn: { flex: 1, minWidth: 0 },
  title: {
    color: "#fff",
    fontSize: 24,
    lineHeight: 27,
    fontFamily: "Anton_400Regular",
    ...iosDisplayTextStyle(24, 27),
  },
  description: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 13,
    fontFamily: "Archivo_400Regular",
    marginTop: 3,
  },
  dateColumn: {
    width: 90,
    flexShrink: 0,
    alignItems: "flex-end",
  },
  dateBlock: { alignItems: "flex-start" },
  weekday: { color: "#fff", fontSize: 14, lineHeight: 17, letterSpacing: 0.35, fontFamily: "Anton_400Regular", textAlign: "left" },
  dateRow: { flexDirection: "row", alignItems: "flex-end", marginTop: -2 },
  day: {
    color: CYAN,
    fontSize: 66,
    lineHeight: 68,
    fontFamily: "Anton_400Regular",
    ...iosDisplayTextStyle(66, 68),
    // Cancel only the guard's added layout space, not its glyph protection.
    marginBottom: -iosCapGuard(66, 68),
  },
  month: { color: "#fff", fontSize: 18, lineHeight: 24, fontFamily: "Anton_400Regular", marginLeft: 3, marginBottom: 6 },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
    minWidth: 0,
  },
  tag: { maxWidth: "100%", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  styleTag: { backgroundColor: classTagColors.danceBackground, flexDirection: "row", gap: 4 },
  tagText: { color: "#fff", fontSize: 10, fontFamily: "Archivo_600SemiBold", flexShrink: 1 },
  styleTagText: { color: classTagColors.danceText },
  footer: {
    gap: 8,
    marginTop: 8,
  },
  instructor: { flexDirection: "row", alignItems: "center", minWidth: 0, marginTop: 8 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,182,215,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.38)",
  },
  initials: { color: CYAN, fontSize: 12, fontFamily: "Archivo_700Bold" },
  instructorCopy: { flex: 1, minWidth: 0, marginLeft: 6 },
  instructorName: { color: "#fff", fontSize: 12.5, lineHeight: 15, fontFamily: "Archivo_600SemiBold" },
  instructorRole: { color: "#A9B2BB", fontSize: 10.5, lineHeight: 13, fontFamily: "Archivo_400Regular" },
  priceRail: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  priceRailText: { color: "#fff", fontSize: 11.5, fontFamily: "Archivo_700Bold" },
});
