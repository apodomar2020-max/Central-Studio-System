import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Image, ImageBackground, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { BalletStudentPreviewSection } from "@/components/ballet/BalletStudentPreviewCard";
import CentralBackButton from "@/components/CentralBackButton";
import { selectAuthoritativeBalletApplications, selectCurrentBalletStudents, selectEligibleBalletChildren, type BalletStudentPreview } from "@/components/ballet/balletStudentPreviewModel";
import { useAppContext } from "@/contexts/AppContext";
import { ACTIVE_APPLICATION_STATUSES, fetchBalletApplicationDetail, fetchBalletGroups, fetchBalletLevels, fetchBalletPackages, fetchBalletSettings, fetchMyApplications, type BalletApplicationDetail } from "@/services/balletAssessmentService";
import { showAuthRequiredPrompt, showParentAccountRequiredPrompt } from "@/utils/authRequired";

const CYAN = "#03B6D7";
const BALLET_LOGO = require("@/assets/images/central-ballet-logo.png");
const MENU_ART = {
  classes: require("@/assets/images/ballet-menu-classes.png"),
  levels: require("@/assets/images/ballet-menu-levels.png"),
  instructors: require("@/assets/images/ballet-menu-instructors.png"),
  requirements: require("@/assets/images/ballet-menu-requirements.png"),
  performance: require("@/assets/images/ballet-menu-performance.png"),
  faq: require("@/assets/images/ballet-menu-faq.png"),
};

type MenuKey = keyof typeof MENU_ART;
type MenuTileProps = { kind: MenuKey; title: string; route: string; width: number; height: number };

function MenuArrow({ down = false }: { down?: boolean }) {
  return <Svg width={44} height={31} viewBox="0 0 42 29" fill="none" style={down ? styles.menuArrowDown : undefined}><Path d="M40.147 20.9887L20.8235 1.5L1.5 20.9887M20.8235 1.5V26.8353" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function MenuTile({ kind, title, route, width, height }: MenuTileProps) {
  const [firstLine, secondLine] = title.split("\n");
  const isCentered = kind === "levels" || kind === "instructors" || kind === "faq";
  const isBottom = kind === "levels" || kind === "faq" || kind === "requirements";
  return <TouchableOpacity onPress={() => { void Haptics.selectionAsync(); router.push(route as never); }} style={[styles.menuTile, { width, height }]} activeOpacity={0.85}>
    <View pointerEvents="none" style={styles.menuClip}>
      <Image source={MENU_ART[kind]} style={styles.menuBackground} resizeMode="stretch" />
      <View style={[styles.menuTitleBlock, isCentered && styles.menuTitleCentered, isBottom && styles.menuTitleBottom, kind === "instructors" && styles.menuTitleInstructors, kind === "requirements" && styles.menuTitleRequirements]}>
        <Text numberOfLines={1} style={[styles.menuTitleLine, styles.menuTitleCyan, kind === "instructors" && styles.menuTitleNarrowLine]}>{firstLine}</Text>
        <Text numberOfLines={1} style={[styles.menuTitleLine, styles.menuTitleWhite, kind === "instructors" && styles.menuTitleNarrowLine]}>{secondLine}</Text>
      </View>
      {(kind === "classes" || kind === "performance") ? <View style={styles.menuArrowBox}><MenuArrow /></View> : null}
      {kind === "requirements" ? <View style={styles.requirementsArrowBox}><MenuArrow down /></View> : null}
    </View>
  </TouchableOpacity>;
}

export default function BalletProgramScreen() {
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const topPad = Platform.OS === "web" ? 20 : insets.top;
  const heroHeight = topPad + 202;
  const { user, children } = useAppContext();
  const [hasActiveApplication, setHasActiveApplication] = useState<boolean | null>(null);
  const [balletStudents, setBalletStudents] = useState<BalletStudentPreview[]>([]);
  const [eligibleBalletChildIds, setEligibleBalletChildIds] = useState<number[]>([]);
  const [balletStudentsLoading, setBalletStudentsLoading] = useState(false);
  const [homeCardImageUrl, setHomeCardImageUrl] = useState<string | null>(null);
  const [heroImageFailed, setHeroImageFailed] = useState(false);

  useFocusEffect(useCallback(() => {
    if (!user) { setHasActiveApplication(false); setBalletStudents([]); setEligibleBalletChildIds([]); setBalletStudentsLoading(false); return undefined; }
    const controller = new AbortController();
    setBalletStudentsLoading(user.accountType === "parent");
    fetchMyApplications(controller.signal).then(async (applications) => {
      if (controller.signal.aborted) return;
      setHasActiveApplication(applications.some((application) => ACTIVE_APPLICATION_STATUSES.has(application.status)));
      setEligibleBalletChildIds(selectEligibleBalletChildren({ children, applications, blockingStatuses: ACTIVE_APPLICATION_STATUSES }).map((child) => Number(child.id)).filter((id) => Number.isInteger(id) && id > 0));
      const currentApplications = selectAuthoritativeBalletApplications(applications);
      if (user.accountType !== "parent" || currentApplications.length === 0) { setBalletStudents([]); return; }
      const [detailResults, levels, groups, packages] = await Promise.all([
        Promise.allSettled(currentApplications.map((application) => fetchBalletApplicationDetail(application.id, controller.signal))),
        fetchBalletLevels(controller.signal).catch(() => []),
        fetchBalletGroups(controller.signal).catch(() => []),
        fetchBalletPackages(controller.signal).catch(() => []),
      ]);
      if (controller.signal.aborted) return;
      const detailsByApplicationId = new Map<number, BalletApplicationDetail | null>();
      detailResults.forEach((result, index) => detailsByApplicationId.set(currentApplications[index]!.id, result.status === "fulfilled" ? result.value : null));
      setBalletStudents(selectCurrentBalletStudents({ applications: currentApplications, detailsByApplicationId, levelNameById: new Map(levels.map((level) => [level.id, level.name])), groupNameById: new Map(groups.map((group) => [group.id, group.name])), packageNameById: new Map(packages.map((pkg) => [pkg.id, pkg.name])) }));
    }).catch(() => { if (!controller.signal.aborted) { setHasActiveApplication(null); setBalletStudents([]); setEligibleBalletChildIds([]); } }).finally(() => { if (!controller.signal.aborted) setBalletStudentsLoading(false); });
    return () => controller.abort();
  }, [children, user]));

  useEffect(() => {
    const controller = new AbortController();
    fetchBalletSettings(controller.signal).then((settings) => setHomeCardImageUrl(settings.homeCardImageUrl)).catch(() => setHomeCardImageUrl(null));
    return () => controller.abort();
  }, []);

  const heroImageSource = useMemo(() => homeCardImageUrl?.trim() && !heroImageFailed ? { uri: homeCardImageUrl.trim() } : require("@/assets/images/ballet_hero.png"), [heroImageFailed, homeCardImageUrl]);
  const menuContentWidth = Math.max(0, viewportWidth - 32);
  const menuRowWidth = Math.max(0, menuContentWidth - 9);
  const primaryWideWidth = menuRowWidth * 464 / (464 + 227);
  const primaryNarrowWidth = menuRowWidth - primaryWideWidth;
  const primaryRowHeight = primaryWideWidth * 349 / 464;
  const instructorWidth = menuRowWidth * 199 / (199 + 491);
  const requirementsWidth = menuRowWidth - instructorWidth;
  const secondaryRowHeight = instructorWidth * 349 / 199;

  function handleApply() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!user) return showAuthRequiredPrompt();
    if (user.accountType !== "parent") return showParentAccountRequiredPrompt();
    router.push((hasActiveApplication ? "/ballet/application-status" : "/ballet/assessment") as never);
  }

  function handleAddAnotherChild() {
    router.push(eligibleBalletChildIds.length
      ? { pathname: "/ballet/assessment" as never, params: { eligibleChildIds: eligibleBalletChildIds.join(",") } }
      : "/ballet/assessment" as never);
  }

  function handleOpenStudent(student: BalletStudentPreview) {
    void Haptics.selectionAsync();
    router.push({ pathname: "/ballet/application-status" as never, params: { id: String(student.applicationId) } });
  }

  return <View style={styles.screen}>
    <View style={[styles.fixedHero, { height: heroHeight }]}>
      <ImageBackground source={heroImageSource} style={StyleSheet.absoluteFill} imageStyle={styles.heroImage} onError={() => setHeroImageFailed(true)} />
      <LinearGradient colors={["rgba(0,0,0,0.72)", "rgba(0,0,0,0.18)", "rgba(0,0,0,0.88)", "#000000"]} locations={[0, 0.35, 0.82, 1]} style={StyleSheet.absoluteFill} />
      <CentralBackButton style={[styles.backButton, { top: topPad + 10 }]} />
      <View style={[styles.heroCopy, { top: topPad + 56 }]}>
        <View style={styles.balletLockup}>
          <View style={styles.balletLogoFrame}><Image source={BALLET_LOGO} style={styles.balletLogo} resizeMode="contain" /></View>
          <View style={styles.balletLockupDivider} />
          <Text style={styles.balletProgramTitle}>Ballet{"\n"}Program</Text>
        </View>
        <Text style={styles.description}>A world-class ballet education program developing technique, artistry, and confidence in dancers of all ages from pre ballet to professional level.</Text>
      </View>
    </View>

    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {user?.accountType === "parent" ? <BalletStudentPreviewSection students={balletStudents} loading={balletStudentsLoading} eligibleChildCount={eligibleBalletChildIds.length} onAddAnotherChild={handleAddAnotherChild} onOpenStudent={handleOpenStudent} /> : <TouchableOpacity style={styles.applyButton} onPress={handleApply}><Text style={styles.applyText}>Apply Now</Text></TouchableOpacity>}
      <View style={styles.menuSection}>
        <Text style={styles.menuHeading}>Ballet Menu</Text>
        <View style={[styles.menuRow, { height: primaryRowHeight }]}><MenuTile kind="classes" title={"Ballet\nClasses"} route="/ballet/classes" width={primaryWideWidth} height={primaryRowHeight} /><MenuTile kind="levels" title={"Ballet\nLevels"} route="/ballet/levels" width={primaryNarrowWidth} height={primaryRowHeight} /></View>
        <View style={[styles.menuRow, { height: secondaryRowHeight }]}><MenuTile kind="instructors" title={"Ballet\nInstructors"} route="/ballet/instructors" width={instructorWidth} height={secondaryRowHeight} /><MenuTile kind="requirements" title={"Program\nRequirements"} route="/ballet/requirements" width={requirementsWidth} height={secondaryRowHeight} /></View>
        <View style={[styles.menuRow, { height: primaryRowHeight }]}><MenuTile kind="performance" title={"Ballet\nPerformance"} route="/ballet/performances" width={primaryWideWidth} height={primaryRowHeight} /><MenuTile kind="faq" title={"Ballet\nFAQ"} route="/ballet/faq" width={primaryNarrowWidth} height={primaryRowHeight} /></View>
      </View>
      <View style={{ height: Platform.OS === "web" ? 80 : 40 }} />
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  fixedHero: { overflow: "hidden", backgroundColor: "#000000" },
  heroImage: { resizeMode: "cover" },
  backButton: { position: "absolute", left: 15, width: 34, height: 34, zIndex: 3 },
  heroCopy: { position: "absolute", left: 15, right: 15 },
  balletLockup: { height: 78, flexDirection: "row", alignItems: "center", marginBottom: 3 },
  balletLogoFrame: { width: 120, height: 78, overflow: "hidden" },
  balletLogo: { position: "absolute", width: 140, height: 140, left: -10, top: -32 },
  balletLockupDivider: { width: 1, height: 68, marginHorizontal: 10, backgroundColor: "rgba(255,255,255,0.82)" },
  balletProgramTitle: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 36, lineHeight: 35, textTransform: "uppercase", includeFontPadding: false },
  description: { color: "#D6D6D6", fontFamily: "Archivo_400Regular", fontSize: 12.5, lineHeight: 17, maxWidth: 355 },
  scroll: { flex: 1, backgroundColor: "#000000" },
  scrollContent: { paddingTop: 0 },
  applyButton: { marginHorizontal: 16, marginTop: 12, height: 42, borderRadius: 21, backgroundColor: CYAN, alignItems: "center", justifyContent: "center" },
  applyText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 14 },
  menuSection: { paddingHorizontal: 16, paddingTop: 2, gap: 8 },
  menuHeading: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 16, lineHeight: 20, marginBottom: 1 },
  menuRow: { flexDirection: "row", gap: 9 },
  menuTile: { borderRadius: 10, overflow: "hidden", position: "relative", backgroundColor: "transparent", flexGrow: 0, flexShrink: 0 },
  menuClip: { ...StyleSheet.absoluteFillObject, borderRadius: 10, overflow: "hidden" },
  menuBackground: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  menuTitleBlock: { position: "absolute", left: 15, top: 25, zIndex: 2, alignItems: "flex-start" },
  menuTitleCentered: { left: 0, right: 0, alignItems: "center" },
  menuTitleBottom: { top: undefined, bottom: 17 },
  menuTitleInstructors: { top: 26, bottom: undefined },
  menuTitleRequirements: { left: 15, right: undefined, alignItems: "flex-start" },
  menuTitleLine: { fontFamily: "Anton_400Regular", fontSize: 25, lineHeight: 25, textTransform: "uppercase", includeFontPadding: false },
  menuTitleNarrowLine: { fontSize: 20, lineHeight: 21 },
  menuTitleCyan: { color: "#006578" },
  menuTitleWhite: { color: "#FFFFFF" },
  menuArrowBox: { position: "absolute", left: 15, bottom: 15, width: 44, height: 31, overflow: "hidden" },
  requirementsArrowBox: { position: "absolute", left: 15, top: 17, width: 44, height: 31, overflow: "hidden" },
  menuArrowDown: { transform: [{ rotate: "180deg" }] },
});
