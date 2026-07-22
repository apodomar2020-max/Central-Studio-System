/**
 * app/ballet/index.tsx — Ballet Program landing page
 *
 * Replaces the former redirect-gate with the full program overview screen.
 * Apply routing still respects existing application status (assessment vs. status page).
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
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

import {
  fetchMyApplications,
  fetchBalletSettings,
  fetchBalletSummary,
  fetchBalletApplicationDetail,
  fetchBalletGroups,
  fetchBalletLevels,
  fetchBalletPackages,
  ACTIVE_APPLICATION_STATUSES,
  type BalletApplicationDetail,
  type BalletSummary,
} from "@/services/balletAssessmentService";
import { useAppContext } from "@/contexts/AppContext";
import { showAuthRequiredPrompt, showParentAccountRequiredPrompt } from "@/utils/authRequired";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";
import { BalletProgramLockup, BallerinaShoesIcon } from "@/components/ballet/BalletProgramLockup";
import BalletProgramDangerZone from "@/components/ballet/BalletProgramDangerZone";
import { BalletStudentPreviewSection } from "@/components/ballet/BalletStudentPreviewCard";
import {
  selectAuthoritativeBalletApplications,
  selectCurrentBalletStudents,
  selectEligibleBalletChildren,
  type BalletStudentPreview,
} from "@/components/ballet/balletStudentPreviewModel";

/* ─── Design tokens ─────────────────────────────────────────────── */
// Base/card/border values taken from the explicit task spec (override the
// design-source ink-800/0.15 variants).
const BASE    = "#000000"; // true black page background
const CARD    = "#15171B"; // nav card surface
const NAV_BORDER = "rgba(0,182,215,0.35)";
const INK_400 = "#4B5563";
const INK_200 = "#D1D5DB";
const CYAN    = "#00B6D7";
const R_MD    = 12;
const R_LG    = 16;

/* ─── Nav card data ──────────────────────────────────────────────── */
const NAV_CARDS = [
  {
    icon: "ballerina-shoes" as const,
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
  icon: React.ComponentProps<typeof Ionicons>["name"] | "ballerina-shoes";
  title: string;
  sub?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={s.navCard} activeOpacity={0.82}>
      <View style={s.navCardIcon}>
        {icon === "ballerina-shoes"
          ? <BallerinaShoesIcon size={22} color={CYAN} />
          : <Ionicons name={icon} size={22} color={CYAN} />}
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
  const { user, children } = useAppContext();

  /* Fetch ballet status for apply-routing (non-blocking — page shows immediately) */
  const [hasActiveApplication, setHasActiveApplication] = useState<boolean | null>(null);
  const [balletStudents, setBalletStudents] = useState<BalletStudentPreview[]>([]);
  const [eligibleBalletChildIds, setEligibleBalletChildIds] = useState<number[]>([]);
  const [balletStudentsLoading, setBalletStudentsLoading] = useState(false);
  const [balletEnrollmentRevision, setBalletEnrollmentRevision] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setHasActiveApplication(false);
        setBalletStudents([]);
        setEligibleBalletChildIds([]);
        setBalletStudentsLoading(false);
        return undefined;
      }

      const ctrl = new AbortController();
      setHasActiveApplication(null);
      setBalletStudents([]);
      setBalletStudentsLoading(user.accountType === "parent");

      fetchMyApplications(ctrl.signal)
        .then(async (apps) => {
          if (ctrl.signal.aborted) return;
          setHasActiveApplication(apps.some((application) => ACTIVE_APPLICATION_STATUSES.has(application.status)));
          setEligibleBalletChildIds(selectEligibleBalletChildren({
            children,
            applications: apps,
            blockingStatuses: ACTIVE_APPLICATION_STATUSES,
          })
            .map((child) => Number(child.id))
            .filter((childId) => Number.isInteger(childId) && childId > 0));

          const currentApplications = selectAuthoritativeBalletApplications(apps);
          if (user.accountType !== "parent" || currentApplications.length === 0) {
            setBalletStudents([]);
            return;
          }

          const [detailResults, levelsResult, groupsResult, packagesResult] = await Promise.all([
            Promise.allSettled(currentApplications.map((application) => fetchBalletApplicationDetail(application.id, ctrl.signal))),
            fetchBalletLevels(ctrl.signal).then((levels) => levels).catch(() => []),
            fetchBalletGroups(ctrl.signal).then((groups) => groups).catch(() => []),
            fetchBalletPackages(ctrl.signal).then((packages) => packages).catch(() => []),
          ]);
          if (ctrl.signal.aborted) return;

          const detailsByApplicationId = new Map<number, BalletApplicationDetail | null>();
          detailResults.forEach((result, index) => {
            detailsByApplicationId.set(
              currentApplications[index]!.id,
              result.status === "fulfilled" ? result.value : null,
            );
          });

          setBalletStudents(selectCurrentBalletStudents({
            applications: currentApplications,
            detailsByApplicationId,
            levelNameById: new Map(levelsResult.map((level) => [level.id, level.name])),
            groupNameById: new Map(groupsResult.map((group) => [group.id, group.name])),
            packageNameById: new Map(packagesResult.map((pkg) => [pkg.id, pkg.name])),
          }));
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setHasActiveApplication(null);
          setBalletStudents([]);
          setEligibleBalletChildIds([]);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setBalletStudentsLoading(false);
        });

      return () => ctrl.abort();
    }, [balletEnrollmentRevision, children, user]),
  );

  const [summary, setSummary] = useState<BalletSummary | null>(null);

  // Refetch the summary on every focus, not just first mount. This screen is a
  // Stack route: pushing to a sub-route (/ballet/instructors, …) keeps it
  // mounted underneath, so returning pops back WITHOUT remounting and a plain
  // useEffect([]) would never re-run. useFocusEffect fires once on first focus
  // (== first mount, so no duplicate initial request) and again on each return,
  // so an instructor added/activated/deactivated/deleted in Admin is reflected
  // when the user comes back. Cleanup aborts the in-flight request on blur/
  // unmount to avoid setting state after unmount. Loading/error behavior is
  // unchanged (shows "—" until resolved; clears to null on error).
  useFocusEffect(
    useCallback(() => {
      const ctrl = new AbortController();
      fetchBalletSummary(ctrl.signal)
        .then((data) => {
          if (ctrl.signal.aborted) return;
          setSummary(data);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setSummary(null);
        });
      return () => ctrl.abort();
    }, []),
  );

  const stats = useMemo(() => [
    { value: summary ? String(summary.activeStudents) : "—", label: "Active students" },
    { value: summary ? String(summary.instructors) : "—", label: "Instructors" },
    { value: summary ? String(summary.levels) : "—", label: "Levels" },
    { value: summary ? String(summary.weeklySchedules) : "—", label: "Classes/week" },
  ], [summary]);

  const [homeCardImageUrl, setHomeCardImageUrl] = useState<string | null>(null);
  const [heroImageFailed, setHeroImageFailed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchBalletSettings(ctrl.signal)
      .then((settings) => {
        if (ctrl.signal.aborted) return;
        setHomeCardImageUrl(settings.homeCardImageUrl);
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setHomeCardImageUrl(null);
      });
    return () => ctrl.abort();
  }, []);

  const heroImageUri = homeCardImageUrl?.trim() || null;

  useEffect(() => {
    setHeroImageFailed(false);
  }, [heroImageUri]);

  const heroImageSource = useMemo(
    () => heroImageUri && !heroImageFailed
      ? { uri: heroImageUri }
      : require("@/assets/images/ballet_hero.png"),
    [heroImageUri, heroImageFailed],
  );

  const activeWeeklySessionsCount = summary?.weeklySchedules ?? 0;
  const balletClassesSub =
    summary && activeWeeklySessionsCount > 0
      ? `${activeWeeklySessionsCount} weekly session${activeWeeklySessionsCount === 1 ? "" : "s"} available`
      : "Browse active ballet classes";

  function handleApply() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!user) {
      showAuthRequiredPrompt();
      return;
    }
    if (user.accountType !== "parent") {
      showParentAccountRequiredPrompt();
      return;
    }
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

  function handleAddAnotherChild() {
    if (eligibleBalletChildIds.length === 0) return;
    Haptics.selectionAsync();
    router.push({
      pathname: "/ballet/assessment" as any,
      params: { eligibleChildIds: eligibleBalletChildIds.join(",") },
    });
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
      <View style={s.headerWrap}>
        <LinearGradient
          colors={["rgba(0,0,0,0.92)", "rgba(0,0,0,0.58)", "rgba(0,0,0,0)"]}
          locations={[0, 0.58, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[s.header, { paddingTop: topPad + 14 }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={s.backBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={20} color={CYAN} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>

        </View>
      </View>

      {/* ── Scrollable content ── */}
      <ScrollView showsVerticalScrollIndicator={false} bounces>
        {/* ── Hero section ── */}
        <View style={[s.heroSection, { minHeight: topPad + 370 }]}>
          <ImageBackground
            source={heroImageSource}
            style={StyleSheet.absoluteFill}
            imageStyle={{ resizeMode: "cover" }}
            onError={() => setHeroImageFailed(true)}
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

          <View style={[s.heroContent, { paddingTop: topPad + 76 }]}>
            {/* Eyebrow */}
            <Text style={s.heroEyebrow}>Central Studio</Text>

            {/* Display title lockup */}
            <BalletProgramLockup variant="hero" style={s.heroLockup} />

            {/* Description */}
            <Text style={s.heroDesc}>
              A world-class ballet education program developing technique, artistry, and
              confidence in dancers of all ages — from Pre Ballet to Professional level.
            </Text>

            {/* Stats card */}
            <View style={s.statsCard}>
              {stats.map((st, i) => (
                <React.Fragment key={st.label}>
                  {i > 0 && <View style={s.statDivider} />}
                  <BStat value={st.value} label={st.label} />
                </React.Fragment>
              ))}
            </View>

            {/* Apply CTA */}
            {(!user || hasActiveApplication === false) && (
              <TouchableOpacity onPress={handleApply} style={s.applyCTA} activeOpacity={0.88}>
                <Text style={s.applyCTAText}>✦ Apply Now</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {user?.accountType === "parent" && (
          <BalletStudentPreviewSection
            students={balletStudents}
            loading={balletStudentsLoading}
            eligibleChildCount={eligibleBalletChildIds.length}
            onAddAnotherChild={handleAddAnotherChild}
          />
        )}

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

        {/* Danger zone — full-width destructive cancellation action, gated on
            authoritative server state. Only meaningful for a signed-in parent
            who has a Ballet application; renders nothing otherwise. Placed
            after the normal program sections, before the final safe-area pad. */}
        {user?.accountType === "parent" && (
          <BalletProgramDangerZone
            onChanged={() => setBalletEnrollmentRevision((revision) => revision + 1)}
          />
        )}

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
  headerWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "transparent",
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
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  /* hero */
  heroSection: {
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 8,
  },
  heroEyebrow: {
    fontSize: 10,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: CYAN,
    marginBottom: 8,
  },
  heroLockup: { marginBottom: 12 },
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
    marginBottom: 10,
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
    ...iosDisplayTextStyle(30, 27),
    marginTop: -iosCapGuard(30, 27),
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

  /* nav section */
  navSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    gap: 10,
    backgroundColor: BASE,
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
