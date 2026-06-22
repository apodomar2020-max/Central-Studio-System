/**
 * app/ballet/index.tsx — Ballet Program landing page
 *
 * Replaces the former redirect-gate with the full program overview screen.
 * Apply routing still respects existing application status (assessment vs. status page).
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ImageBackground,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useListClasses } from "@workspace/api-client-react";

import {
  fetchMyApplications,
  ACTIVE_APPLICATION_STATUSES,
} from "@/services/balletAssessmentService";
import { mapApiClassToMobile } from "@/data/apiAdapters";

/* ─── Design tokens ─────────────────────────────────────────────── */
// Base/card/border values taken from the explicit task spec (override the
// design-source ink-800/0.15 variants).
const BASE    = "#0A0B0D"; // dark ambient base
const CARD    = "#15171B"; // nav card surface
const NAV_BORDER = "rgba(0,182,215,0.35)";
const INK_400 = "#4B5563";
const INK_200 = "#D1D5DB";
const CYAN    = "#00B6D7";
const R_MD    = 12;
const R_LG    = 16;
const R_PILL  = 999;

/* ─── Nav card data ──────────────────────────────────────────────── */
const NAV_CARDS = [
  {
    icon: "star-outline" as const,
    title: "Ballet Levels",
    sub: "Pre Ballet → Professional — 6 levels",
    route: "/ballet/levels",
  },
  {
    icon: "calendar-outline" as const,
    title: "Ballet Classes",
    sub: "Browse active ballet classes",
    route: "/ballet/classes",
  },
  {
    icon: "people-outline" as const,
    title: "Instructors",
    sub: "Meet our ballet faculty",
    route: "/ballet/instructors",
  },
  {
    icon: "ribbon-outline" as const,
    title: "Performance Opportunities",
    sub: "Showcases, recitals & competitions",
    route: "/ballet/performances",
  },
  {
    icon: "list-outline" as const,
    title: "Program Requirements",
    sub: "Dress code, attendance & progression",
    route: "/ballet/requirements",
  },
  {
    icon: "help-circle-outline" as const,
    title: "FAQ",
    sub: "Common questions answered",
    route: "/ballet/faq",
  },
  {
    icon: "call-outline" as const,
    title: "Contact Ballet Department",
    sub: "ballet@centralstudio.eg",
    route: "/ballet/contact",
  },
] as const;

/* ─── Stats data ─────────────────────────────────────────────────── */
const STATS = [
  { value: "48", label: "Active students" },
  { value: "3",  label: "Instructors" },
  { value: "6",  label: "Levels" },
  { value: "12", label: "Classes/week" },
];

/* ─── BStat atom ─────────────────────────────────────────────────── */
function BStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.statCol}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

/* ─── BNavCard atom ──────────────────────────────────────────────── */
function BNavCard({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  sub?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={s.navCard} activeOpacity={0.82}>
      <View style={s.navCardIcon}>
        <Ionicons name={icon} size={22} color={CYAN} />
      </View>
      <View style={s.navCardText}>
        <Text style={s.navCardTitle}>{title}</Text>
        {!!sub && <Text style={s.navCardSub}>{sub}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={17} color={CYAN} style={{ opacity: 0.5 }} />
    </TouchableOpacity>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN SCREEN
═══════════════════════════════════════════════════════════════════ */
export default function BalletProgramScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  /* Fetch ballet status for apply-routing (non-blocking — page shows immediately) */
  const [hasActiveApplication, setHasActiveApplication] = useState<boolean | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchMyApplications(ctrl.signal)
      .then((apps) => {
        if (ctrl.signal.aborted) return;
        setHasActiveApplication(apps.some((a) => ACTIVE_APPLICATION_STATUSES.has(a.status)));
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setHasActiveApplication(false);
      });
    return () => ctrl.abort();
  }, []);

  /* Live ballet-class count for the "Ballet Classes" nav card subtitle.
     Uses the existing classes API filtered via the adapter's isBallet flag —
     no new backend. Falls back to generic copy while loading / on error / 0. */
  const classesQuery = useListClasses();
  const balletClassCount = useMemo(
    () =>
      (classesQuery.data ?? [])
        .filter((c) => c.isActive)
        .map((c) => mapApiClassToMobile(c))
        .filter((c) => c.isBallet).length,
    [classesQuery.data],
  );
  const balletClassesSub =
    classesQuery.isSuccess && balletClassCount > 0
      ? `${balletClassCount} active class${balletClassCount === 1 ? "" : "es"} available`
      : "Browse active ballet classes";

  function handleApply() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (hasActiveApplication) {
      router.push("/ballet/application-status" as any);
    } else {
      router.push("/ballet/assessment" as any);
    }
  }

  function handleNavCard(route: string | null) {
    Haptics.selectionAsync();
    if (route) router.push(route as any);
  }

  return (
    <View style={s.screen}>
      {/* ── Ambient cyan atmospheric glow (behind hero) ── */}
      <LinearGradient
        colors={["rgba(0,182,215,0.22)", "rgba(0,182,215,0.08)", "transparent"]}
        locations={[0, 0.35, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[s.atmosphericGlow, { height: topPad + 380 }]}
        pointerEvents="none"
      />

      {/* ── Sticky Header ── */}
      <View style={[s.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color={CYAN} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={s.headerTitle}>Ballet Program</Text>

        <TouchableOpacity onPress={handleApply} style={s.headerApplyBtn} activeOpacity={0.85}>
          <Text style={s.headerApplyText}>Apply ✦</Text>
        </TouchableOpacity>
      </View>

      {/* ── Scrollable content ── */}
      <ScrollView showsVerticalScrollIndicator={false} bounces>
        {/* ── Hero section ── */}
        <View style={s.heroSection}>
          <ImageBackground
            source={require("@/assets/images/ballet_hero.png")}
            style={StyleSheet.absoluteFill}
            imageStyle={{ resizeMode: "cover" }}
          />
          {/* 4-stop gradient overlay matching design */}
          <LinearGradient
            colors={[
              "rgba(5,6,8,0.38)",
              "rgba(5,6,8,0.22)",
              "rgba(5,6,8,0.82)",
              "rgba(5,6,8,0.97)",
            ]}
            locations={[0, 0.3, 0.75, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          <View style={s.heroContent}>
            {/* Eyebrow */}
            <Text style={s.heroEyebrow}>Central Studio</Text>

            {/* Display title */}
            <Text style={s.heroTitle}>{"Ballet\nProgram"}</Text>

            {/* Description */}
            <Text style={s.heroDesc}>
              A world-class ballet education program developing technique, artistry, and
              confidence in dancers of all ages — from Pre Ballet to Professional level.
            </Text>

            {/* Stats card */}
            <View style={s.statsCard}>
              {STATS.map((st, i) => (
                <React.Fragment key={st.label}>
                  {i > 0 && <View style={s.statDivider} />}
                  <BStat value={st.value} label={st.label} />
                </React.Fragment>
              ))}
            </View>

            {/* Apply CTA */}
            <TouchableOpacity onPress={handleApply} style={s.applyCTA} activeOpacity={0.88}>
              <Text style={s.applyCTAText}>✦ Apply Now</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Cyan divider line ── */}
        <View style={s.heroDivider} />

        {/* ── Navigation cards ── */}
        <View style={s.navSection}>
          {NAV_CARDS.map((card) => (
            <BNavCard
              key={card.title}
              icon={card.icon}
              title={card.title}
              sub={card.route === "/ballet/classes" ? balletClassesSub : card.sub}
              onPress={() => handleNavCard(card.route)}
            />
          ))}
        </View>

        {/* Footer spacing */}
        <View style={{ height: Platform.OS === "web" ? 120 : 80 }} />
      </ScrollView>
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────── */
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BASE },

  /* atmospheric glow */
  atmosphericGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },

  /* header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,182,215,0.15)",
    backgroundColor: BASE,
    zIndex: 10,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backText: {
    fontSize: 14,
    fontFamily: "Archivo_600SemiBold",
    color: CYAN,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Archivo_800ExtraBold",
    color: "#fff",
  },
  headerApplyBtn: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: R_PILL,
    backgroundColor: CYAN,
  },
  headerApplyText: {
    fontSize: 12.5,
    fontFamily: "Archivo_800ExtraBold",
    color: "#fff",
  },

  /* hero */
  heroSection: {
    minHeight: 320,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,182,215,0.12)",
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 22,
  },
  heroEyebrow: {
    fontSize: 10,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: CYAN,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 52,
    fontFamily: "Anton_400Regular",
    textTransform: "uppercase",
    color: "#fff",
    lineHeight: 52,
    marginBottom: 12,
  },
  heroDesc: {
    fontSize: 15,
    fontFamily: "Archivo_400Regular",
    color: INK_200,
    lineHeight: 24,
    marginBottom: 22,
  },

  /* stats card */
  statsCard: {
    flexDirection: "row",
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: R_LG,
    marginBottom: 20,
  },
  statCol: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 30,
    fontFamily: "Anton_400Regular",
    color: "#fff",
    lineHeight: 27,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Archivo_400Regular",
    color: INK_400,
    marginTop: 5,
    textAlign: "center",
  },
  statDivider: {
    width: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
  },

  /* apply CTA */
  applyCTA: {
    width: "100%",
    paddingVertical: 15,
    backgroundColor: CYAN,
    borderRadius: R_MD,
    alignItems: "center",
    shadowColor: CYAN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  applyCTAText: {
    fontSize: 15,
    fontFamily: "Archivo_800ExtraBold",
    color: "#fff",
    letterSpacing: 0.3,
  },

  /* divider below hero */
  heroDivider: {
    height: 1,
    backgroundColor: "rgba(0,182,215,0.12)",
    marginHorizontal: 0,
  },

  /* nav section */
  navSection: {
    padding: 20,
    gap: 10,
  },
  navCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    paddingHorizontal: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: NAV_BORDER,
    borderRadius: R_LG,
  },
  navCardIcon: {
    width: 42,
    height: 42,
    borderRadius: R_MD,
    backgroundColor: "rgba(0,182,215,0.12)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  navCardText: { flex: 1 },
  navCardTitle: {
    fontSize: 15,
    fontFamily: "Archivo_700Bold",
    color: "#fff",
  },
  navCardSub: {
    fontSize: 12.5,
    fontFamily: "Archivo_400Regular",
    color: INK_400,
    marginTop: 1,
  },
});
