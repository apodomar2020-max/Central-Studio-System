import * as Haptics from "expo-haptics";
import { GlassView } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useMemo } from "react";
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import type { DanceClass, Instructor } from "@/data/mockData";
import CategoryIcon from "@/components/CategoryIcon";
import { useAppContext } from "@/contexts/AppContext";
import { showAuthRequiredPrompt } from "@/utils/authRequired";

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
};

export type DiscoveryStyleIcon = {
  iconSvg?: string | null;
  iconUrl?: string | null;
  legacyIcon?: string | null;
  color?: string;
};

export function PriceTagIcon() {
  return (
    <Svg width={12} height={12} viewBox="0 0 11 11" fill="none">
      <Path
        d="M0.264779 7.06868L3.8639 10.667C4.03472 10.8366 4.26568 10.9318 4.5064 10.9318C4.74712 10.9318 4.97807 10.8366 5.14889 10.667L10.2987 5.51718C10.6829 5.08891 10.9064 4.54049 10.9309 3.96568L10.8957 0.947137C10.8912 0.704655 10.7928 0.473367 10.6212 0.302032C10.4496 0.130696 10.2181 0.032699 9.9756 0.028701L6.96608 0C6.39126 0.0259049 5.84309 0.249864 5.41458 0.633885L0.264779 5.78369C0.09517 5.95451 -0.000013 6.18546 -0.000013 6.42618C-0.000013 6.6669 0.09517 6.89786 0.264779 7.06868ZM8.47822 1.83113C8.47822 1.47244 8.769 1.18166 9.12769 1.18166C9.48639 1.18166 9.77717 1.47244 9.77717 1.83113C9.77717 2.18982 9.48639 2.4806 9.12769 2.4806C8.769 2.4806 8.47822 2.18982 8.47822 1.83113ZM3.07093 7.85673C2.89363 7.67965 2.89363 7.3909 3.07093 7.21382L3.39976 6.88499C3.26415 6.67711 3.16694 6.44658 3.11275 6.20436C3.05494 5.98837 3.05457 5.76101 3.11167 5.54483C3.16878 5.32864 3.28137 5.13113 3.4383 4.97186C3.66158 4.74947 3.95784 4.61546 4.27228 4.59464C4.81388 4.55969 5.34869 4.77476 5.73439 5.18424C6.05386 5.52362 6.48248 5.64833 6.75451 5.42369C6.80656 5.36499 6.84205 5.29348 6.85733 5.21653C6.8726 5.13957 6.86712 5.05993 6.84144 4.9858C6.78404 4.76491 6.66785 4.5637 6.50522 4.40357C6.28863 4.22727 6.02927 4.10964 5.76146 4.07638C5.51054 4.07638 5.30716 3.873 5.30716 3.62208C5.30716 3.37116 5.51054 3.16778 5.76146 3.16778C6.1277 3.16924 6.48665 3.28112 6.79224 3.49416L7.11861 3.16614C7.29628 2.98872 7.58443 2.98891 7.76192 3.16655C7.9394 3.34425 7.93922 3.6324 7.76151 3.80987L7.44334 4.12722C7.57596 4.32839 7.67227 4.55126 7.72789 4.78571C7.78727 5.00956 7.78799 5.24494 7.72996 5.46915C7.67193 5.69336 7.55712 5.89884 7.3966 6.06578C7.17871 6.27915 6.89413 6.41116 6.59051 6.43971C6.03849 6.49631 5.48754 6.26738 5.09231 5.82715C4.87502 5.61357 4.55537 5.45251 4.3346 5.5016C4.23947 5.50809 4.14983 5.54854 4.08203 5.61558C4.04103 5.65576 3.94672 5.75089 4.00249 6.01576C4.08539 6.35001 4.30986 6.63827 4.61997 6.79315C4.7743 6.87676 4.93832 6.97442 5.08411 6.95633C5.33442 6.93822 5.552 7.12644 5.57039 7.37701C5.5885 7.62735 5.40026 7.84492 5.14971 7.86329C4.75833 7.89299 4.37474 7.76969 4.03939 7.53036L3.71383 7.85673C3.53645 8.03327 3.24847 8.03327 3.07093 7.85673Z"
        fill="white"
      />
    </Svg>
  );
}

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

function levelColor(level: DanceClass["level"]) {
  switch (level) {
    case "Beginner": return "#20C65A";
    case "Intermediate": return "#FFB02E";
    case "Advanced": return "#FF3B47";
    default: return "#D800D8";
  }
}

function ageColor(ageGroup: DanceClass["ageGroup"]) {
  switch (ageGroup) {
    case "Kids": return "#075CE5";
    case "Teens": return "#7C3AED";
    case "Adults": return "#FF6B2C";
  }
}

export default function DiscoveryClassCard({ item, instructor, styleIcon, onSelect, onBook, style }: Props) {
  const { user } = useAppContext();
  const date = useMemo(() => dateParts(item), [item.date, item.dayOfWeek]);
  const status = classStatus(item);
  const isBookable = Boolean(item.scheduleId && item.dayOfWeek && item.startTime)
    && item.status !== "full"
    && item.status !== "cancelled"
    && item.status !== "unavailable";

  const openDetails = () => {
    if (onSelect) {
      onSelect(item);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/class/[id]", params: { id: item.id, scheduleId: item.scheduleId } });
  };

  const book = () => {
    if (!isBookable) return;
    if (onBook) {
      onBook(item);
      return;
    }
    if (!user) {
      showAuthRequiredPrompt();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({ pathname: "/booking/flow", params: { classId: item.id, scheduleId: item.scheduleId } });
  };

  const ageLabel = item.ageRangeLabel || item.ageGroup;

  return (
    <View style={[styles.rail, style]}>
      <TouchableOpacity style={styles.card} onPress={openDetails} activeOpacity={0.92}>
        <View style={styles.imageArea}>
          {item.photoUrl ? (
            <Image source={{ uri: item.photoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
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

        <View style={styles.infoPanelShell}>
          <GlassView
            glassEffectStyle="clear"
            tintColor="rgba(3,21,24,0.20)"
            colorScheme="dark"
            pointerEvents="none"
            style={styles.glassBackdrop}
          />

          <View style={styles.infoPanelContent}>
            <View style={styles.copyColumn}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.description} numberOfLines={4}>{item.description}</Text>
            </View>

            <View style={styles.dateColumn}>
              <Text style={styles.weekday} numberOfLines={1} adjustsFontSizeToFit>{date.weekday}</Text>
              <View style={styles.dateRow}>
                <Text style={styles.day}>{date.day}</Text>
                <Text style={styles.month}>{date.month}</Text>
              </View>
            </View>

            <View style={styles.tags}>
              <View style={[styles.tag, styles.styleTag]}>
                <CategoryIcon
                  iconSvg={styleIcon?.iconSvg}
                  iconUrl={styleIcon?.iconUrl}
                  legacyIcon={styleIcon?.legacyIcon}
                  name={item.categoryName}
                  color={styleIcon?.color || CYAN}
                  size={12}
                />
                <Text style={[styles.tagText, styles.styleTagText]} numberOfLines={1}>{item.categoryName}</Text>
              </View>
              <View style={[styles.tag, { backgroundColor: levelColor(item.level) }]}>
                <Text style={styles.tagText} numberOfLines={1}>{item.level}</Text>
              </View>
              <View style={[styles.tag, { backgroundColor: ageColor(item.ageGroup) }]}>
                <Text style={styles.tagText} numberOfLines={1}>{ageLabel}</Text>
              </View>
            </View>

            <View style={styles.footer}>
              <View style={styles.instructor}>
                <View style={styles.avatar}>
                  {instructor?.photoUrl ? (
                    <Image source={{ uri: instructor.photoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : (
                    <Text style={styles.initials}>{instructor?.initials || "?"}</Text>
                  )}
                </View>
                <View style={styles.instructorCopy}>
                  <Text style={styles.instructorName} numberOfLines={1}>{instructor?.name || "Instructor"}</Text>
                  <Text style={styles.instructorRole} numberOfLines={1}>{instructorRole(instructor, item.categoryName)}</Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={book}
                disabled={!isBookable}
                activeOpacity={0.84}
                style={[styles.bookButton, !isBookable && styles.bookButtonDisabled]}
              >
                <Text style={[styles.bookText, !isBookable && styles.bookTextDisabled]}>
                  {item.status === "cancelled" ? "Cancelled" : item.status === "full" ? "Full" : item.status === "unavailable" ? "Unavailable" : isBookable ? "Book Now" : "N/A"}
                </Text>
              </TouchableOpacity>
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
    height: 346,
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
  imageArea: { height: 210, width: "100%", backgroundColor: "#17191D" },
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
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    height: 194,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  infoPanelContent: {
    flex: 1,
    width: "100%",
    padding: 12,
    backgroundColor: "transparent",
  },
  glassBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(1,8,10,0.48)",
  },
  copyColumn: { width: "62%", minHeight: 84 },
  title: {
    color: "#fff",
    fontSize: 24,
    lineHeight: 27,
    fontFamily: "Anton_400Regular",
  },
  description: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 13,
    fontFamily: "Archivo_400Regular",
    marginTop: 3,
  },
  dateColumn: {
    position: "absolute",
    right: 12,
    top: 12,
    width: "36%",
    alignItems: "flex-start",
  },
  weekday: { color: "#fff", fontSize: 14, lineHeight: 17, letterSpacing: 0.35, fontFamily: "Anton_400Regular", textAlign: "left" },
  dateRow: { flexDirection: "row", alignItems: "flex-end", marginTop: -2 },
  day: { color: CYAN, fontSize: 66, lineHeight: 68, fontFamily: "Anton_400Regular" },
  month: { color: "#fff", fontSize: 18, lineHeight: 24, fontFamily: "Anton_400Regular", marginLeft: 3, marginBottom: 6 },
  tags: {
    flexDirection: "row",
    gap: 5,
    marginTop: 5,
  },
  tag: { maxWidth: "34%", minWidth: 58, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, alignItems: "center", justifyContent: "center", flexShrink: 1 },
  styleTag: { maxWidth: "38%", backgroundColor: "#fff", flexDirection: "row", gap: 4 },
  tagText: { color: "#fff", fontSize: 9.5, fontFamily: "Archivo_600SemiBold" },
  styleTagText: { color: CYAN },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 7,
  },
  instructor: { flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 },
  avatar: {
    width: 29,
    height: 29,
    borderRadius: 15,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,182,215,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.38)",
  },
  initials: { color: CYAN, fontSize: 10, fontFamily: "Archivo_700Bold" },
  instructorCopy: { flex: 1, minWidth: 0, marginLeft: 6 },
  instructorName: { color: "#fff", fontSize: 10.5, lineHeight: 12, fontFamily: "Archivo_600SemiBold" },
  instructorRole: { color: "#A9B2BB", fontSize: 9, lineHeight: 11, fontFamily: "Archivo_400Regular" },
  bookButton: {
    width: "48%",
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  bookButtonDisabled: { backgroundColor: "rgba(255,255,255,0.10)" },
  bookText: { color: CYAN, fontSize: 19, lineHeight: 22, fontFamily: "Anton_400Regular" },
  bookTextDisabled: { color: "#737982", fontSize: 14 },
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
