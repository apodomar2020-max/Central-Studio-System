import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { VideoView, useVideoPlayer } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dimensions,
  FlatList,
  Image,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useAppContext } from "@/contexts/AppContext";
import { DanceClass, Instructor } from "@/data/mockData";
import {
  useListHeroItems,
  useListInstructors,
  useListSchedules,
  useListClasses,
  useListPricePackages,
  customFetch,
} from "@workspace/api-client-react";
import type {
  HeroItem,
  Notification as ApiNotification,
  PricePackage,
} from "@workspace/api-client-react";
import {
  compareSchedulesByNextOccurrence,
  mapApiClassWithScheduleToMobile,
  mapApiInstructorToMobile,
} from "@/data/apiAdapters";
import { formatCairoDateKey, getCairoTomorrowDateKey } from "@/utils/cairoDate";
import colors from "@/constants/colors";
import NewStudentBanner from "@/components/NewStudentBanner";
import { InstructorCardSkeleton, ClassListCardSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";
import { DEFAULT_SINGLE_CLASS_PRICE_EGP, fetchClassPricing } from "@/services/classPricingService";

const { width: SW } = Dimensions.get("window");

// ─── Design tokens (aligned to _ds/tokens/colors.css — Fix Pack 1) ──────────
// See constants/colors.ts for the canonical source.
const INK_900 = "#0A0B0D"; // --cs-ink-900  (app background)
const INK_800 = "#15171B"; // --cs-ink-800  (card background)
const INK_700 = "#22262C"; // --cs-ink-700  (card-light / elevated surface)
const INK_400 = "#6B747F"; // --cs-ink-400  (secondary icon / muted border)
const INK_300 = "#8E97A2"; // --cs-ink-300  (secondary text)
const INK_200 = "#B6BDC6"; // --cs-ink-200  (on-dark secondary)
const CYAN    = "#00B6D7"; // --cs-cyan-500 / primary
const MAGENTA = "#FF2E7E"; // --cs-magenta-500
const LIME    = "#B6E80A"; // --cs-lime-500  (Kids chips)
const VIOLET  = "#7C3AED"; // --cs-violet-500 (Adults chips)
const AMBER   = "#FFB02E"; // --cs-amber-500
const SUCCESS = "#1FB871"; // --cs-success-500
const ERROR   = "#FF3B47"; // --cs-danger-500
const BORDER  = "rgba(255,255,255,0.08)";
const R_SM    = 8;   // --radius-sm
const R_MD    = 12;  // --radius-md
const R_LG    = 16;  // --radius-lg
const R_PILL  = 999; // --radius-pill

// ─── Hero carousel constants ───────────────────────────────────────────────────
const HERO_H    = 196;
const HERO_W    = SW - 40; // 20px gutter each side — matches design calc(100% - 40px)
const HERO_GAP  = 14;      // matches design gap: 14
const HERO_SNAP = HERO_W + HERO_GAP;

// AsyncStorage key shared with notifications.tsx for read API notification IDs
const API_NOTIF_READ_KEY = "api_notif_read_ids";

// ─── Presentation helpers ──────────────────────────────────────────────────────
/** Derive compact style label: "Hip Hop & Afro Instructor" → "Hip Hop & Afro" */
function styleLabel(title: string): string {
  return title.replace(/\s*Instructor\s*$/i, "").trim() || title;
}

/** Map ageGroup to design colour token */
function ageGroupColor(ag: string): string {
  if (ag === "Kids") return LIME;
  if (ag === "Teens") return CYAN;
  if (ag === "Adults") return VIOLET;
  return INK_300;
}

// ─── Hero Carousel ────────────────────────────────────────────────────────────

function HeroSlide({ item, onInteract }: { item: HeroItem; onInteract?: () => void }) {
  return (
    <View style={s.heroSlide}>
      <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {/* Gradient: design spec rgba(6,7,8,0.15)→0.45→0.9; content bottom-aligned */}
      <LinearGradient
        colors={["rgba(6,7,8,0.15)", "rgba(6,7,8,0.45)", "rgba(6,7,8,0.90)"]}
        locations={[0, 0.45, 1]}
        style={s.heroGradient}
      >
        {/* All content stacks at the bottom (justifyContent: flex-end on parent) */}
        <View style={s.heroContent}>
          {!!item.tagline && (
            <Text style={s.heroEyebrow}>{item.tagline.toUpperCase()}</Text>
          )}
          <Text style={s.heroTitle} numberOfLines={3}>{item.title}</Text>
        </View>
        {/* CTA row: marginTop 12, sub-text placeholder left + CTA pill right */}
        <View style={s.heroCTARow}>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() => {
              onInteract?.();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(item.buttonRoute as any);
            }}
            style={s.heroCTA}
            activeOpacity={0.85}
          >
            <Text style={s.heroCTAText}>{item.buttonText}</Text>
            <Ionicons name="arrow-forward" size={14} color={INK_900} />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

function HeroSkeleton() {
  return (
    <View style={s.heroWrap}>
      <View style={[s.heroSlide, { backgroundColor: "#14141C" }]}>
        <View style={{ padding: 16, flex: 1, justifyContent: "flex-end", gap: 8 }}>
          <View style={{ width: 100, height: 8, borderRadius: 4, backgroundColor: "#222" }} />
          <View style={{ width: "70%", height: 22, borderRadius: 6, backgroundColor: "#222" }} />
          <View style={{ alignSelf: "flex-end", width: 88, height: 28, borderRadius: R_PILL, backgroundColor: "#222" }} />
        </View>
      </View>
      {/* Dots placeholder */}
      <View style={s.heroDots}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[s.heroDot, i === 0
            ? { width: 20, backgroundColor: CYAN }
            : { width: 5, backgroundColor: "rgba(255,255,255,0.22)" }]} />
        ))}
      </View>
    </View>
  );
}

function HeroCarousel({
  items, isLoading, isError, error, onRetry,
}: {
  items: HeroItem[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<HeroItem>>(null);
  const activeIndexRef = useRef(0);
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAuto = useCallback(() => {
    if (autoTimerRef.current) { clearInterval(autoTimerRef.current); autoTimerRef.current = null; }
  }, []);
  const clearResume = useCallback(() => {
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
  }, []);

  const scrollTo = useCallback((index: number, animated = true) => {
    if (!items.length) return;
    const next = ((index % items.length) + items.length) % items.length;
    activeIndexRef.current = next;
    setActiveIndex(next);
    listRef.current?.scrollToOffset({ offset: HERO_SNAP * next, animated });
  }, [items.length]);

  const startAuto = useCallback(() => {
    clearAuto();
    if (items.length <= 1) return;
    autoTimerRef.current = setInterval(() => scrollTo(activeIndexRef.current + 1), 5000);
  }, [clearAuto, items.length, scrollTo]);

  const pauseAuto = useCallback(() => {
    clearAuto(); clearResume();
    if (items.length <= 1) return;
    resumeTimerRef.current = setTimeout(() => startAuto(), 20000);
  }, [clearAuto, clearResume, items.length, startAuto]);

  useEffect(() => {
    activeIndexRef.current = 0;
    setActiveIndex(0);
    clearResume();
    startAuto();
    return () => { clearAuto(); clearResume(); };
  }, [clearAuto, clearResume, items.length, startAuto]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / HERO_SNAP);
    activeIndexRef.current = idx;
    setActiveIndex(idx);
  };

  const Dots = ({ count, active }: { count: number; active: number }) => (
    <View style={s.heroDots}>
      {Array.from({ length: count }).map((_, i) => (
        <TouchableOpacity
          key={i}
          onPress={() => { pauseAuto(); scrollTo(i); }}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <View style={[s.heroDot, i === active
            ? { width: 20, backgroundColor: CYAN }
            : { width: 5, backgroundColor: "rgba(255,255,255,0.22)" }]} />
        </TouchableOpacity>
      ))}
    </View>
  );

  if (isLoading) return <HeroSkeleton />;

  if (isError) {
    return (
      <View style={s.heroWrap}>
        <View style={[s.heroSlide, { backgroundColor: INK_800, justifyContent: "center", alignItems: "center" }]}>
          {isOfflineError(error)
            ? <OfflineState variant="compact" onRetry={onRetry} />
            : <ErrorState variant="compact" onRetry={onRetry} message="Couldn't load featured content." />}
        </View>
      </View>
    );
  }

  if (!items.length) return null;

  if (items.length === 1) {
    return (
      <View style={s.heroWrap}>
        <View style={{ paddingLeft: 20 }}>
          <HeroSlide item={items[0]} />
        </View>
        <Dots count={1} active={0} />
      </View>
    );
  }

  return (
    <View style={s.heroWrap}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(i) => String(i.id)}
        renderItem={({ item }) => <HeroSlide item={item} onInteract={pauseAuto} />}
        horizontal
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={pauseAuto}
        onMomentumScrollEnd={onScroll}
        snapToInterval={HERO_SNAP}
        decelerationRate="fast"
        bounces={false}
        contentContainerStyle={{ paddingLeft: 20, paddingRight: 20, gap: HERO_GAP }}
        style={{ overflow: "visible", height: HERO_H } as any}
      />
      <Dots count={items.length} active={activeIndex} />
    </View>
  );
}

// ─── Instagram Reels ──────────────────────────────────────────────────────────

const REEL_W = 150;
const REEL_H = 210;

interface InstagramReel {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

function AutoReelCard({ reel, onPress }: { reel: InstagramReel; onPress: () => void }) {
  const player = useVideoPlayer(reel.media_url ?? "", (p) => { p.loop = true; p.muted = true; p.play(); });
  useEffect(() => () => { player.release(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <TouchableOpacity style={s.reelCard} activeOpacity={0.82} onPress={onPress}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <View style={s.reelPlayBtn}>
        <Ionicons name="logo-instagram" size={16} color="#fff" />
      </View>
    </TouchableOpacity>
  );
}

function ReelsSection() {
  const { data, isLoading, isError } = useQuery<{ reels: InstagramReel[] }>({
    queryKey: ["instagram-reels"],
    queryFn: async () => (await customFetch("/api/instagram/reels")) as { reels: InstagramReel[] },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const reels = data?.reels ?? [];
  const [autoPlay, setAutoPlay] = useState(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reels.length > 0 && !autoPlay) {
      setAutoPlay(true);
      autoTimer.current = setTimeout(() => setAutoPlay(false), 5000);
    }
    return () => { if (autoTimer.current) clearTimeout(autoTimer.current); };
  }, [reels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isError || (!isLoading && reels.length === 0)) return null;

  return (
    <View style={[s.section, { marginBottom: 8 }]}>
      <View style={s.sectionHeader}>
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <Ionicons name="logo-instagram" size={13} color={MAGENTA} />
            <Text style={[s.eyebrow, { color: MAGENTA }]}>@CENTRAL.STUDIO.EG</Text>
          </View>
          <Text style={s.sectionTitle}>Latest reels</Text>
        </View>
        <TouchableOpacity
          onPress={() => Linking.openURL("https://www.instagram.com/central.studio.eg/")}
          style={s.seeAllRow}
        >
          <Text style={s.seeAllText}>Follow</Text>
          <Ionicons name="chevron-forward" size={13} color={INK_300} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <FlatList
          data={[1, 2, 3, 4]}
          keyExtractor={(i) => String(i)}
          renderItem={() => <View style={[s.reelCard, { opacity: 0.3 }]} />}
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: 20, gap: 10 }}
          scrollEnabled={false}
        />
      ) : (
        <FlatList
          data={reels}
          keyExtractor={(r) => r.id}
          renderItem={({ item, index }) => {
            const handlePress = () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (typeof item.permalink === "string" && item.permalink.startsWith("https://")) {
                Linking.openURL(item.permalink);
              }
            };
            if (index === 0 && autoPlay && item.media_url) {
              return <AutoReelCard reel={item} onPress={handlePress} />;
            }
            return (
              <TouchableOpacity style={s.reelCard} activeOpacity={0.82} onPress={handlePress}>
                {item.thumbnail_url
                  ? <Image source={{ uri: item.thumbnail_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  : <LinearGradient colors={[INK_700, INK_800]} style={StyleSheet.absoluteFill} />}
                <View style={s.reelPlayBtn}>
                  <Ionicons name="play" size={18} color="#fff" />
                </View>
              </TouchableOpacity>
            );
          }}
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: 20, gap: 10, paddingRight: 20 }}
        />
      )}
    </View>
  );
}

// ─── Instructor Card ──────────────────────────────────────────────────────────
// Matches design: width=132, height=168, style badge top-left, name overlay bottom

function InstructorCard({ instructor }: { instructor: Instructor }) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [instructor.photoUrl]);

  const label = styleLabel(instructor.title);

  return (
    <TouchableOpacity
      style={s.instCard}
      activeOpacity={0.85}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/instructor/[id]", params: { id: instructor.id } });
      }}
    >
      {instructor.photoUrl && !imgFailed ? (
        <Image
          source={{ uri: instructor.photoUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <LinearGradient
          colors={[CYAN + "CC", CYAN + "33", INK_900]}
          start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        >
          <View style={s.instInitialsBg}>
            <Text style={s.instInitials}>{instructor.initials}</Text>
          </View>
        </LinearGradient>
      )}

      {/* Style badge at top-left */}
      {!!label && (
        <View style={s.instBadge}>
          <Text style={s.instBadgeText} numberOfLines={1}>{label}</Text>
        </View>
      )}

      {/* Name overlay at bottom */}
      <LinearGradient
        colors={["transparent", "rgba(6,7,8,0.88)"]}
        style={s.instOverlay}
      >
        <Text style={s.instName} numberOfLines={1}>{instructor.name}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Class Card ───────────────────────────────────────────────────────────────
// Matches design standard layout: image header | body (title+price | meta | divider | inst+book)

function ClassCard({
  item,
  instructorMap,
  packageCreditsRemaining = 0,
}: {
  item: DanceClass;
  instructorMap?: Map<string, Instructor>;
  packageCreditsRemaining?: number;
}) {
  const instructor = instructorMap?.get(item.instructorId);
  const available = item.capacity - item.bookedCount;
  const hasSchedule = Boolean(item.scheduleId && item.dayOfWeek && item.startTime);
  const isBookable  = hasSchedule && item.status !== "full";
  const canCredits  = item.packageEligible !== false && packageCreditsRemaining > 0;

  const today     = formatCairoDateKey();
  const tomorrow  = getCairoTomorrowDateKey();
  const dayLabel  = item.date === today ? "Today" : item.date === tomorrow ? "Tomorrow" : item.dayOfWeek;

  const statusColor =
    !hasSchedule ? INK_400 :
    item.status === "available" ? SUCCESS :
    item.status === "fewSeats"  ? AMBER :
    item.status === "full"      ? ERROR : VIOLET;

  const statusLabel =
    !hasSchedule ? "No schedule" :
    item.status === "available" ? "Available" :
    item.status === "fewSeats"  ? `${available} left` :
    item.status === "full"      ? "Full" : "Waitlist";

  const levelCol = ageGroupColor(item.ageGroup);

  return (
    <TouchableOpacity
      style={s.classCard}
      activeOpacity={0.88}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/class/[id]", params: { id: item.id, scheduleId: item.scheduleId } });
      }}
    >
      {/* ── Image header ────────────────────────────────────────────────────── */}
      <View style={s.classImg}>
        {item.photoUrl ? (
          <Image source={{ uri: item.photoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <LinearGradient colors={[INK_700, INK_800]} style={StyleSheet.absoluteFill} />
        )}
        {/* Image dims like design (opacity 0.5 feel via gradient overlay) */}
        <LinearGradient
          colors={["rgba(6,7,8,0.10)", "rgba(6,7,8,0.68)"]}
          style={StyleSheet.absoluteFill}
        />
        {/* Chips */}
        <View style={s.classChips}>
          <View style={[s.levelChip, { borderColor: levelCol }]}>
            <Text style={[s.levelChipText, { color: levelCol }]}>{item.ageGroup}</Text>
          </View>
          <View style={[s.statusChip, { backgroundColor: statusColor + "26" }]}>
            <View style={[s.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[s.statusChipText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
      </View>

      {/* ── Card body ───────────────────────────────────────────────────────── */}
      <View style={s.classBody}>
        {/* Row 1: title + price */}
        <View style={s.classTitleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.classTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={s.classDesc} numberOfLines={2}>{item.description}</Text>
          </View>
          <Text style={s.classPrice}>
            {item.price > 0 ? `EGP ${item.price}` : "—"}
          </Text>
        </View>

        {/* Row 2: MetaRow */}
        {hasSchedule && (
          <View style={s.classMeta}>
            <Ionicons name="calendar-outline" size={13} color={INK_300} />
            <Text style={s.classMetaText}>{dayLabel} · {item.startTime}</Text>
            <View style={s.classMetaSep} />
            <Ionicons name="time-outline" size={13} color={INK_300} />
            <Text style={s.classMetaText}>{item.duration}</Text>
          </View>
        )}
      </View>

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <View style={s.classDiv} />

      {/* ── Footer: instructor tag + book button ────────────────────────────── */}
      <View style={s.classFooter}>
        {/* Instructor tag */}
        <View style={s.instTag}>
          <View style={s.instTagAvatar}>
            {instructor?.photoUrl ? (
              <Image source={{ uri: instructor.photoUrl }} style={s.instTagImage} />
            ) : (
              <Text style={s.instTagInitials}>{instructor?.initials ?? "?"}</Text>
            )}
          </View>
          <Text style={s.instTagName} numberOfLines={1}>{instructor?.name ?? "—"}</Text>
        </View>

        {/* Buttons */}
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          {canCredits && (
            <TouchableOpacity
              onPress={() => {
                if (!isBookable) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/booking/flow", params: { classId: item.id, scheduleId: item.scheduleId, usePackage: "true" } });
              }}
              disabled={!isBookable}
              style={[s.creditBtn, !isBookable && { opacity: 0.4 }]}
            >
              <Text style={s.creditBtnText}>{packageCreditsRemaining} cr</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => {
              if (!isBookable) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push({ pathname: "/booking/flow", params: { classId: item.id, scheduleId: item.scheduleId } });
            }}
            disabled={!isBookable}
            style={[
              s.bookBtn,
              isBookable ? { backgroundColor: CYAN } : { backgroundColor: INK_700 },
            ]}
          >
            <Text style={[s.bookBtnText, { color: isBookable ? INK_900 : INK_400 }]}>
              {item.status === "full" ? "Waitlist" : isBookable ? "Book" : "N/A"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Package cards ────────────────────────────────────────────────────────────

function PackageCard({ pkg }: { pkg: PricePackage }) {
  const hot     = pkg.isFeatured;
  const credits = pkg.sessions ?? 1;
  const perCls  = pkg.singleClassPriceEgp ?? (credits > 1 ? Math.round(pkg.priceEgp / credits) : 0);
  const iconName = hot ? "star" : credits === 1 ? "ticket-outline" : "infinite-outline";

  return (
    <TouchableOpacity
      style={[s.pkgCard, hot && s.pkgCardHot]}
      activeOpacity={0.88}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/(tabs)/packages"); }}
    >
      {hot && (
        <View style={s.pkgBadge}>
          <Ionicons name="star" size={10} color={INK_900} />
          <Text style={s.pkgBadgeText}>POPULAR</Text>
        </View>
      )}
      <View style={[s.pkgIcon, hot && { backgroundColor: CYAN }]}>
        <Ionicons name={iconName as any} size={20} color={hot ? INK_900 : CYAN} />
      </View>
      <Text style={s.pkgName}>{pkg.name}</Text>
      <View style={s.pkgPriceRow}>
        <Text style={[s.pkgPrice, !hot && { color: "#fff" }]}>EGP {pkg.priceEgp}</Text>
        <Text style={s.pkgUnit}>/{credits === 1 ? "class" : `${credits} cls`}</Text>
      </View>
      {perCls > 0 && credits > 1 && (
        <Text style={s.pkgPer}>EGP {perCls} per class</Text>
      )}
      <View style={[s.pkgBtn, hot && { backgroundColor: CYAN }]}>
        <Text style={[s.pkgBtnText, hot && { color: INK_900 }]}>Choose {pkg.name}</Text>
      </View>
    </TouchableOpacity>
  );
}

function PackagesSection() {
  const { data: raw, isLoading, isError } = useListPricePackages();
  const pkgs = React.useMemo(
    () => (raw ?? []).filter((p: PricePackage) => p.isActive !== false),
    [raw],
  );

  if (isError || (!isLoading && pkgs.length === 0)) {
    return (
      <View style={[s.section, { paddingHorizontal: 20 }]}>
        <LinearGradient colors={["#003A47", "#001828"]} style={s.pkgPromo}>
          <View style={s.pkgPromoIcon}>
            <Ionicons name="card" size={24} color={CYAN} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.pkgPromoTitle}>Save with Class Packages</Text>
            <Text style={s.pkgPromoDesc}>4, 8, or 12 classes — any style, 6-month validity</Text>
          </View>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/(tabs)/packages"); }}
            style={s.pkgPromoBtn}
          >
            <Text style={s.pkgPromoBtnText}>View</Text>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <View>
          <Text style={s.eyebrow}>SAVE MORE, DANCE MORE</Text>
          <Text style={s.sectionTitle}>Packages</Text>
        </View>
        <TouchableOpacity onPress={() => router.push("/(tabs)/packages")} style={s.seeAllRow}>
          <Text style={s.seeAllText}>Compare</Text>
          <Ionicons name="chevron-forward" size={13} color={INK_300} />
        </TouchableOpacity>
      </View>
      {isLoading ? (
        <View style={{ paddingLeft: 20, flexDirection: "row", gap: 12 }}>
          {[1, 2].map((i) => <View key={i} style={[s.pkgCard, { opacity: 0.3 }]} />)}
        </View>
      ) : (
        <FlatList
          data={pkgs}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => <PackageCard pkg={item} />}
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: 20, gap: 12, paddingRight: 20 }}
        />
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function StudioHomeScreen() {
  const { user, unreadNotifications, bookings, newStudentBannerDismissed, dismissNewStudentBanner, userPackages } = useAppContext();
  const insets = useSafeAreaInsets();

  const showNewStudentBanner = bookings.length === 0 && !newStudentBannerDismissed;

  const userInitials = React.useMemo(() => {
    if (!user?.fullName) return "";
    return user.fullName.split(/\s+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  }, [user?.fullName]);

  const packageCreditsRemaining = React.useMemo(
    () => userPackages.filter((p) => p.status === "active" && p.remainingCredits > 0).reduce((sum, p) => sum + p.remainingCredits, 0),
    [userPackages],
  );

  // ── Unread notifications count (bell badge) ──────────────────────────────
  const [apiUnread, setApiUnread] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      try {
        const [notifs, raw] = await Promise.all([
          customFetch<ApiNotification[]>("/api/notifications/my"),
          AsyncStorage.getItem(API_NOTIF_READ_KEY),
        ]);
        if (!active) return;
        const read = raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
        setApiUnread(notifs.filter((n) => !n.isDraft && !read.has(`api-${n.id}`)).length);
      } catch { /* silently ignore */ }
    })();
    return () => { active = false; };
  }, []));
  const totalUnread = unreadNotifications + apiUnread;
  const badgeLabel  = totalUnread > 99 ? "99+" : String(totalUnread);

  // ── Hero items ────────────────────────────────────────────────────────────
  const { data: allHero, refetch: refetchHero, isLoading: heroLoading, isError: heroError, error: heroErr } = useListHeroItems();
  const heroItems: HeroItem[] = React.useMemo(
    () => (allHero ?? []).filter((i) => i.isActive), [allHero],
  );

  // ── Instructors ───────────────────────────────────────────────────────────
  const { data: apiInst, refetch: refetchInst, isRefetching: refetchingInst, isLoading: instLoading, isError: instError, error: instErr } = useListInstructors();
  const instructors: Instructor[] = React.useMemo(
    () => (apiInst ?? []).filter((i) => i.isActive).map(mapApiInstructorToMobile), [apiInst],
  );
  const instructorMap = React.useMemo(() => {
    const m = new Map<string, Instructor>();
    instructors.forEach((i) => m.set(i.id, i));
    return m;
  }, [instructors]);

  // ── Schedules + classes ───────────────────────────────────────────────────
  const { data: apiScheds, refetch: refetchScheds, isRefetching: refetchingScheds, isLoading: schedsLoading, isError: schedsError, error: schedsErr } = useListSchedules();
  const { data: apiClasses, refetch: refetchClasses, isRefetching: refetchingClasses, isLoading: classesLoading } = useListClasses();
  const pricingQuery = useQuery({ queryKey: ["class-pricing"], queryFn: fetchClassPricing, staleTime: 5 * 60 * 1000 });
  const singlePrice  = pricingQuery.data?.singleClassPriceEgp ?? DEFAULT_SINGLE_CLASS_PRICE_EGP;

  const weekClasses = React.useMemo<DanceClass[]>(() => {
    if (!apiScheds?.length || !apiClasses?.length) return [];
    const classMap = new Map(apiClasses.map((c) => [c.id, c]));

    const result = [...apiScheds]
      .sort((a, b) => compareSchedulesByNextOccurrence(a, b))
      .map((sched) => {
        const cls = classMap.get(sched.classId);
        if (!cls || !cls.isActive) return null;
        const mapped = mapApiClassWithScheduleToMobile(cls, sched, singlePrice);
        if (mapped.isBallet) return null;
        return mapped;
      })
      .filter((i): i is DanceClass => i !== null);

    const deduped: DanceClass[] = [];
    for (const m of result) {
      const key = `${m.id}-${m.scheduleId ?? m.date}`;
      if (!deduped.some((r) => `${r.id}-${r.scheduleId ?? r.date}` === key)) deduped.push(m);
    }

    const parseTime = (t: string) => {
      const x = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!x) return 0;
      let h = parseInt(x[1], 10);
      const min = parseInt(x[2], 10);
      if (x[3].toUpperCase() === "PM" && h !== 12) h += 12;
      if (x[3].toUpperCase() === "AM" && h === 12) h = 0;
      return h * 60 + min;
    };

    return deduped.sort((a, b) =>
      a.date !== b.date ? a.date.localeCompare(b.date) : parseTime(a.startTime) - parseTime(b.startTime),
    ).slice(0, 5);
  }, [apiScheds, apiClasses, singlePrice]);

  const isRefreshing = refetchingInst || refetchingScheds || refetchingClasses;
  const onRefresh = useCallback(() => {
    refetchHero(); refetchInst(); refetchScheds(); refetchClasses();
  }, [refetchHero, refetchInst, refetchScheds, refetchClasses]);

  const topPad = Platform.OS === "web" ? 20 : insets.top + 6;

  return (
    <View style={s.screen}>
      {/* Dark-teal glow behind header + hero */}
      <LinearGradient
        colors={["rgba(0,98,115,0.22)", "rgba(0,98,115,0.07)", "transparent"]}
        locations={[0, 0.4, 1]}
        style={s.bgGlow}
        pointerEvents="none"
      />

      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: topPad }]}>
        <Image
          source={require("@/assets/images/central_studio_logo.png")}
          style={s.logo}
          resizeMode="contain"
        />
        <View style={s.headerRight}>
          {/* Bell */}
          <TouchableOpacity onPress={() => router.push("/notifications")} style={s.headerBtn}>
            <Ionicons name="notifications-outline" size={20} color={INK_200} />
            {totalUnread > 0 && <View style={s.badge} />}
          </TouchableOpacity>
          {/* Avatar */}
          <TouchableOpacity
            onPress={() => router.push(user ? "/(tabs)/profile" : "/auth/login")}
            style={s.avatarBtn}
            activeOpacity={0.82}
          >
            {user?.avatarUrl
              ? <Image source={{ uri: user.avatarUrl }} style={s.avatarImg} resizeMode="cover" />
              : userInitials
              ? <Text style={s.avatarInitials}>{userInitials}</Text>
              : <Ionicons name="person-outline" size={18} color={INK_300} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Scroll ── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 110 : 84 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={CYAN} colors={[CYAN]} />
        }
      >
        {showNewStudentBanner && <NewStudentBanner onDismiss={dismissNewStudentBanner} />}

        {/* Hero */}
        <HeroCarousel
          items={heroItems}
          isLoading={heroLoading}
          isError={heroError}
          error={heroErr}
          onRetry={refetchHero}
        />

        {/* Instructors */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View>
              <Text style={s.eyebrow}>LEARN FROM THE BEST</Text>
              <Text style={s.sectionTitle}>Instructors</Text>
            </View>
            <TouchableOpacity onPress={() => router.push("/(tabs)/classes")} style={s.seeAllRow}>
              <Text style={s.seeAllText}>See all</Text>
              <Ionicons name="chevron-forward" size={13} color={INK_300} />
            </TouchableOpacity>
          </View>
          {instLoading ? (
            <FlatList
              data={[1, 2, 3, 4]} keyExtractor={(i) => String(i)}
              renderItem={() => <InstructorCardSkeleton />}
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingLeft: 20, gap: 10 }}
              scrollEnabled={false}
            />
          ) : instError ? (
            isOfflineError(instErr)
              ? <OfflineState variant="compact" onRetry={refetchInst} />
              : <ErrorState variant="compact" onRetry={refetchInst} message="Couldn't load instructors." />
          ) : (
            <FlatList
              data={instructors} keyExtractor={(i) => i.id}
              renderItem={({ item }) => <InstructorCard instructor={item} />}
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingLeft: 20, gap: 10, paddingRight: 20 }}
            />
          )}
        </View>

        {/* Upcoming Classes */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View>
              <Text style={s.eyebrow}>DON'T MISS OUT</Text>
              <Text style={s.sectionTitle}>Upcoming classes</Text>
            </View>
            <TouchableOpacity onPress={() => router.push("/(tabs)/classes")} style={s.seeAllRow}>
              <Text style={s.seeAllText}>See all</Text>
              <Ionicons name="chevron-forward" size={13} color={INK_300} />
            </TouchableOpacity>
          </View>

          {schedsLoading || classesLoading ? (
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              {[1, 2, 3].map((i) => <ClassListCardSkeleton key={i} />)}
            </View>
          ) : schedsError ? (
            isOfflineError(schedsErr)
              ? <OfflineState variant="compact" onRetry={() => { refetchScheds(); refetchClasses(); }} />
              : <ErrorState variant="compact" onRetry={() => { refetchScheds(); refetchClasses(); }} message="Couldn't load upcoming classes." />
          ) : weekClasses.length === 0 ? (
            <View style={s.emptyCard}>
              <Ionicons name="calendar-outline" size={30} color={INK_400} />
              <Text style={s.emptyTitle}>No upcoming scheduled classes</Text>
              <Text style={s.emptyDesc}>Classes will appear here once schedules are set up in the portal.</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              {weekClasses.map((cls) => (
                <ClassCard
                  key={`${cls.id}-${cls.date}`}
                  item={cls}
                  instructorMap={instructorMap}
                  packageCreditsRemaining={packageCreditsRemaining}
                />
              ))}
            </View>
          )}
        </View>

        {/* Packages */}
        <PackagesSection />

        {/* Reels */}
        <ReelsSection />
      </ScrollView>
    </View>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // ── Screen ────────────────────────────────────────────────────────────────
  screen: { flex: 1, backgroundColor: INK_900 },
  bgGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 400, zIndex: 0, pointerEvents: "none" as any },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingBottom: 14, zIndex: 1,
  },
  // Design: width 100, height 63
  logo: { width: 100, height: 63 },
  headerRight: { flexDirection: "row", gap: 12, alignItems: "center" },
  // Design: 42×42, bg rgba(255,255,255,0.06), border 1px rgba(255,255,255,0.10)
  headerBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center", justifyContent: "center",
    overflow: "hidden",
  },
  // Design: top:9, right:10, width:8, height:8 — INSIDE the 42×42 button
  badge: {
    position: "absolute", top: 9, right: 10,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: MAGENTA,
    zIndex: 10,
    borderWidth: 2, borderColor: INK_900,
  },
  badgeText: { fontSize: 8, fontFamily: "Archivo_700Bold", color: "#fff" },
  // Design: 42×42, boxShadow 0 0 0 2px cyan → borderWidth: 2, borderColor: CYAN
  avatarBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: CYAN + "22",
    borderWidth: 2, borderColor: CYAN,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarInitials: { fontSize: 13, fontFamily: "Archivo_700Bold", color: CYAN },

  // ── Section headers ────────────────────────────────────────────────────────
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "flex-end", paddingHorizontal: 20, marginBottom: 12,
  },
  eyebrow: {
    fontSize: 10, fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.8, color: CYAN,
    textTransform: "uppercase", marginBottom: 3,
  },
  sectionTitle: { fontSize: 24, fontFamily: "Archivo_700Bold", color: "#fff", letterSpacing: -0.3, lineHeight: 28 },
  seeAllRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  seeAllText: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: INK_300 },

  // ── Hero wrap ──────────────────────────────────────────────────────────────
  heroWrap: { marginBottom: 22, overflow: "visible" as any },
  heroSlide: {
    width: HERO_W, height: HERO_H,
    borderRadius: R_LG, overflow: "hidden",
    backgroundColor: INK_800,
    borderWidth: 1, borderColor: BORDER,
  },
  // Design: padding 18px 20px, all content justifyContent flex-end (bottom-aligned)
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 18,
  },
  heroContent: { gap: 0 },
  // Design: role-eyebrow, marginBottom: 7
  heroEyebrow: { fontSize: 9, fontFamily: "SpaceMono_700Bold", color: CYAN, letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 7 },
  // Design: font-display, fontSize: 36, lineHeight: 0.9 → 36×0.9=32, uppercase
  heroTitle: { fontSize: 36, fontFamily: "Anton_400Regular", color: "#fff", lineHeight: 32, textTransform: "uppercase", letterSpacing: 0 },
  // Design: marginTop: 12, justifyContent: space-between (sub text left, CTA right)
  heroCTARow: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  // Design: height: 28, padding: 0 10px, gap: 15, fontSize: 10
  heroCTA: {
    flexDirection: "row", alignItems: "center", gap: 15,
    backgroundColor: CYAN,
    paddingHorizontal: 10, height: 28,
    borderRadius: R_PILL,
  },
  heroCTAText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", color: INK_900, letterSpacing: 0 },
  // Dots sit BELOW the FlatList (marginTop from design: 14)
  heroDots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 12 },
  heroDot: { height: 5, borderRadius: 2.5 },

  // ── Instructor cards ───────────────────────────────────────────────────────
  // Design: width=132, height=168
  instCard: { width: 132, height: 168, borderRadius: R_MD, overflow: "hidden", backgroundColor: INK_800 },
  instBadge: {
    position: "absolute", top: 8, left: 8,
    backgroundColor: "rgba(0,182,215,0.92)",
    borderRadius: R_PILL, paddingHorizontal: 7, paddingVertical: 3,
    maxWidth: 90,
  },
  instBadgeText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", color: INK_900, textTransform: "uppercase", letterSpacing: 1 },
  instInitialsBg: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    alignSelf: "center", marginTop: 34,
    backgroundColor: CYAN + "30",
  },
  instInitials: { fontSize: 17, fontFamily: "Archivo_700Bold", color: CYAN },
  instOverlay: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 9, paddingBottom: 9, paddingTop: 28,
  },
  instName: { fontSize: 13, fontFamily: "Archivo_700Bold", color: "#fff", lineHeight: 16 },

  // ── Class card ─────────────────────────────────────────────────────────────
  classCard: {
    borderRadius: R_LG, overflow: "hidden",
    backgroundColor: "rgb(0,0,0)",
    borderWidth: 1, borderColor: BORDER,
  },
  classImg: { height: 130, position: "relative" },
  classChips: {
    position: "absolute", top: 12, left: 12, right: 12,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  levelChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R_PILL,
    borderWidth: 1, backgroundColor: "rgba(255,255,255,0.06)",
  },
  levelChipText: { fontSize: 9, fontFamily: "SpaceMono_700Bold", textTransform: "uppercase", letterSpacing: 0.8 },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R_PILL },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusChipText: { fontSize: 11, fontFamily: "Archivo_700Bold" },
  // Body: padding 15 16 16 from design, gap 11
  classBody: { padding: 15, paddingBottom: 12, gap: 10 },
  classTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  classTitle: { fontSize: 18, fontFamily: "Archivo_700Bold", color: "#fff", lineHeight: 22, marginBottom: 3 },
  classDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: INK_300, lineHeight: 19 },
  classPrice: { fontSize: 20, fontFamily: "Anton_400Regular", color: CYAN, lineHeight: 22, flexShrink: 0 },
  classMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  classMetaText: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: INK_300 },
  classMetaSep: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: INK_400 },
  classDiv: { height: 1, backgroundColor: "rgba(255,255,255,0.07)", marginHorizontal: 0 },
  // Footer: design has InstructorTag left + BookButton right
  classFooter: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 15, paddingVertical: 12,
  },
  instTag: { flexDirection: "row", alignItems: "center", gap: 8 },
  instTagAvatar: {
    width: 28, height: 28, borderRadius: 14,
    overflow: "hidden", alignItems: "center", justifyContent: "center",
    backgroundColor: CYAN + "22",
  },
  instTagImage: { width: "100%", height: "100%" },
  instTagInitials: { fontSize: 10, fontFamily: "Archivo_700Bold", color: CYAN },
  instTagName: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: INK_200, maxWidth: 110 },
  // Package credits ghost pill (only shown when user has credits)
  creditBtn: {
    paddingHorizontal: 9, paddingVertical: 6, borderRadius: R_MD,
    borderWidth: 1, borderColor: CYAN + "50",
    backgroundColor: CYAN + "10",
  },
  creditBtnText: { fontSize: 10, fontFamily: "Archivo_700Bold", color: CYAN },
  // Book button — matches design BookButton: padding 10 20, borderRadius radius-md, font-heading 800 14
  bookBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: R_MD },
  bookBtnText: { fontSize: 13, fontFamily: "Archivo_800ExtraBold" },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyCard: {
    marginHorizontal: 20, borderRadius: R_LG, borderWidth: 1, borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.14)", padding: 28,
    alignItems: "center", gap: 8, backgroundColor: INK_800,
  },
  emptyTitle: { fontSize: 14, fontFamily: "Archivo_600SemiBold", color: "#fff", textAlign: "center" },
  emptyDesc: { fontSize: 12, fontFamily: "Archivo_400Regular", color: INK_300, textAlign: "center", lineHeight: 17 },

  // ── Package cards ──────────────────────────────────────────────────────────
  pkgCard: {
    width: 200, borderRadius: R_LG, overflow: "hidden",
    backgroundColor: INK_800, borderWidth: 1, borderColor: BORDER, padding: 18,
  },
  pkgCardHot: { borderColor: CYAN + "60", backgroundColor: "linear-gradient(160deg, rgba(0,182,215,0.16), rgba(0,182,215,0.04))" as any },
  pkgBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start", backgroundColor: CYAN,
    borderRadius: R_PILL, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 10,
  },
  pkgBadgeText: { fontSize: 8, fontFamily: "Archivo_800ExtraBold", color: INK_900, letterSpacing: 1 },
  pkgIcon: {
    width: 40, height: 40, borderRadius: R_MD,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  pkgName: { fontSize: 17, fontFamily: "Archivo_700Bold", color: "#fff", marginBottom: 6 },
  pkgPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 4 },
  pkgPrice: { fontSize: 32, fontFamily: "Anton_400Regular", color: CYAN, lineHeight: 30 },
  pkgUnit: { fontSize: 11, fontFamily: "Archivo_400Regular", color: INK_400 },
  pkgPer: { fontSize: 10, fontFamily: "Archivo_500Medium", color: INK_400, marginBottom: 14 },
  pkgBtn: {
    marginTop: "auto" as any, paddingVertical: 11, borderRadius: R_MD,
    backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center",
  },
  pkgBtnText: { fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: "#fff" },

  // ── Package promo fallback ─────────────────────────────────────────────────
  pkgPromo: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 16,
    borderRadius: R_LG, borderWidth: 1, borderColor: CYAN + "30", marginBottom: 24,
  },
  pkgPromoIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: CYAN + "20", alignItems: "center", justifyContent: "center",
  },
  pkgPromoTitle: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: "#fff" },
  pkgPromoDesc: { fontSize: 11, fontFamily: "Archivo_400Regular", color: INK_300, marginTop: 2, lineHeight: 15 },
  pkgPromoBtn: { backgroundColor: CYAN, paddingHorizontal: 14, paddingVertical: 8, borderRadius: R_MD },
  pkgPromoBtnText: { fontSize: 12, fontFamily: "Archivo_800ExtraBold", color: INK_900 },

  // ── Reels ──────────────────────────────────────────────────────────────────
  reelCard: {
    width: REEL_W, height: REEL_H, borderRadius: R_MD, overflow: "hidden",
    backgroundColor: INK_700, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: BORDER,
  },
  reelPlayBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.50)",
    alignItems: "center", justifyContent: "center",
  },
});
