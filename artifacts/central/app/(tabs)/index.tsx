import * as Haptics from "expo-haptics";
import { VideoView, useVideoPlayer } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Animated,
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

import Svg, { Defs, RadialGradient, Rect as SvgRect, Stop } from "react-native-svg";

import { useAppContext } from "@/contexts/AppContext";
import { isSafeAppRoute, safePush } from "@/utils/navigation";
import CsIcon from "@/components/CsIcon";
import { DanceClass, Instructor } from "@/data/mockData";
import {
  useListHeroItems,
  useListInstructors,
  useListSchedules,
  useListClasses,
  useListPricePackages,
  customFetch,
  normalizeMediaUrl,
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
import { showAuthRequiredPrompt } from "@/utils/authRequired";

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
  // Task 1.1: Hero is an IMAGE CAROUSEL ONLY — no tagline / title / CTA text.
  // Each slide is just the image; tapping the card navigates to its optional,
  // validated path (`buttonRoute`). normalizeMediaUrl makes Google Drive share
  // links render and returns undefined for invalid/non-http URLs (graceful — the
  // slide just shows its dark background instead of crashing).
  const uri = normalizeMediaUrl(item.imageUrl);
  const canTap = isSafeAppRoute(item.buttonRoute);

  // Dark INK_800 background (heroSlide) shows through if the image is missing or
  // fails to load — broken images never crash the hero.
  const Img = uri ? (
    <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
  ) : null;

  if (!canTap) {
    return <View style={s.heroSlide}>{Img}</View>;
  }
  return (
    <TouchableOpacity
      style={s.heroSlide}
      activeOpacity={0.9}
      onPress={() => {
        onInteract?.();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        safePush(item.buttonRoute); // validated + guarded; ignored if unavailable
      }}
    >
      {Img}
    </TouchableOpacity>
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
            ? { width: 22, backgroundColor: CYAN }
            : { width: 6, backgroundColor: "rgba(255,255,255,0.22)" }]} />
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
    resumeTimerRef.current = setTimeout(() => startAuto(), 5000);
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
            ? { width: 22, backgroundColor: CYAN }
            : { width: 6, backgroundColor: "rgba(255,255,255,0.22)" }]} />
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

// Reel cards: 9:16 aspect ratio — design spec
const REEL_W = 120;
const REEL_H = 213; // 120 × (16/9) ≈ 213

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
        <CsIcon name="instagram" size={16} color="#fff" />
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
    <View style={[s.section, { marginBottom: 12 }]}>
      <View style={s.sectionHeader}>
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <CsIcon name="instagram" size={16} color={MAGENTA} />
            <Text style={[s.eyebrow, { color: MAGENTA }]}>@CENTRAL.STUDIO.EG</Text>
          </View>
          <Text style={s.sectionTitle}>Latest reels</Text>
        </View>
        <TouchableOpacity
          onPress={() => Linking.openURL("https://www.instagram.com/central.studio.eg/")}
          style={s.seeAllRow}
        >
          <Text style={s.seeAllText}>Follow</Text>
          <CsIcon name="chevron" size={15} stroke={2.4} color={INK_300} />
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
                  <CsIcon name="play" size={14} color="#fff" />
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
}: {
  item: DanceClass;
  instructorMap?: Map<string, Instructor>;
}) {
  const { user } = useAppContext();
  const instructor = instructorMap?.get(item.instructorId);
  const available = item.capacity - item.bookedCount;
  const hasSchedule = Boolean(item.scheduleId && item.dayOfWeek && item.startTime);
  const isBookable  = hasSchedule && item.status !== "full";

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
            <CsIcon name="calendar" size={15} stroke={2} color={INK_300} />
            <Text style={s.classMetaText}>{dayLabel} · {item.startTime}</Text>
            <View style={s.classMetaSep} />
            <CsIcon name="clock" size={15} stroke={2} color={INK_300} />
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

        {/* Book — the single booking entry point. Payment selection (pay now vs
            package credits) happens INSIDE the booking flow, not here. */}
        <TouchableOpacity
          onPress={() => {
            if (!isBookable) return;
            if (!user) {
              showAuthRequiredPrompt();
              return;
            }
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push({ pathname: "/booking/flow", params: { classId: item.id, scheduleId: item.scheduleId } });
          }}
          disabled={!isBookable}
          style={[
            s.bookBtn,
            // Design: bookable = cyan-500; disabled/full = rgba(255,255,255,0.06).
            isBookable ? { backgroundColor: CYAN } : { backgroundColor: "rgba(255,255,255,0.06)" },
          ]}
        >
          <Text style={[s.bookBtnText, { color: isBookable ? INK_900 : INK_300 }]}>
            {item.status === "full" ? "Waitlist" : isBookable ? "Book" : "N/A"}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Package cards ────────────────────────────────────────────────────────────

function PackageCard({ pkg }: { pkg: PricePackage }) {
  const { user } = useAppContext();
  const hot     = pkg.isFeatured;
  const credits = pkg.sessions ?? 1;
  const perCls  = pkg.singleClassPriceEgp ?? (credits > 1 ? Math.round(pkg.priceEgp / credits) : 0);
  const iconName: "star" | "ticket" | "infinity" = hot ? "star" : credits === 1 ? "ticket" : "infinity";

  return (
    <TouchableOpacity
      style={[s.pkgCard, hot && s.pkgCardHot]}
      activeOpacity={0.88}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (!user) {
          showAuthRequiredPrompt();
          return;
        }
        router.push("/(tabs)/packages");
      }}
    >
      {hot && (
        <View style={s.pkgBadge}>
          <CsIcon name="star" size={12} color={INK_900} />
          <Text style={s.pkgBadgeText}>POPULAR</Text>
        </View>
      )}
      <View style={[s.pkgIcon, hot && { backgroundColor: CYAN }]}>
        <CsIcon name={iconName} size={22} stroke={2.2} color={hot ? INK_900 : CYAN} />
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
            <CsIcon name="ticket" size={24} stroke={2.2} color={CYAN} />
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
          <CsIcon name="chevron" size={15} stroke={2.4} color={INK_300} />
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

/** Header bell with the design's periodic ring wobble (bellRing keyframes, every 5s). */
function BellButton({ hasUnread, onPress }: { hasUnread: boolean; onPress: () => void }) {
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    function wobble() {
      ring.setValue(0);
      Animated.timing(ring, { toValue: 1, duration: 820, useNativeDriver: true }).start();
    }
    wobble();
    const id = setInterval(wobble, 5000);
    return () => clearInterval(id);
  }, [ring]);
  const rotate = ring.interpolate({
    inputRange: [0, 0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 1],
    outputRange: ["0deg", "18deg", "-16deg", "14deg", "-10deg", "7deg", "-4deg", "2deg", "0deg"],
  });
  // design bellGlow: magenta halo pushes out (0→6px→10px) and fades each ring
  const glowOpacity = ring.interpolate({ inputRange: [0, 0.2, 0.6, 1], outputRange: [0, 0.22, 0.08, 0] });
  const glowScale = ring.interpolate({ inputRange: [0, 0.2, 0.6, 1], outputRange: [0.7, 1.0, 1.3, 1.55] });
  return (
    <View style={s.bellWrap}>
      <Animated.View pointerEvents="none" style={[s.bellGlow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
      <TouchableOpacity onPress={onPress} style={s.headerBtn}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <CsIcon name="bell" size={21} color={INK_200} />
        </Animated.View>
        {hasUnread && <View style={s.badge} />}
      </TouchableOpacity>
    </View>
  );
}

export default function StudioHomeScreen() {
  // ── Screen entrance animation (opacity 0→1, translateY 18→0, 520ms) ────────
  const enterOpacity = useRef(new Animated.Value(0)).current;
  const enterY       = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(enterOpacity, { toValue: 1, duration: 520, useNativeDriver: true }),
      Animated.timing(enterY,       { toValue: 0, duration: 520, useNativeDriver: true }),
    ]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { user, unreadNotifications, bookings, newStudentBannerDismissed, dismissNewStudentBanner } = useAppContext();
  const insets = useSafeAreaInsets();

  const showNewStudentBanner = false;

  const userInitials = React.useMemo(() => {
    if (!user?.fullName) return "";
    return user.fullName.split(/\s+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  }, [user?.fullName]);

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
    <Animated.View style={[s.screen, { opacity: enterOpacity, transform: [{ translateY: enterY }] }]}>
      {/* Exact design feed glow:
          radial-gradient(80% 110% at 50% -5%, rgba(163,230,53,0.11) 0%, transparent 52%)  (lime, top-center)
          radial-gradient(65% 70%  at 95% 95%, rgba(0,182,215,0.13) 0%, transparent 55%)   (cyan, bottom-right) */}
      <Svg style={s.bgGlow} pointerEvents="none">
        <Defs>
          <RadialGradient id="homeGlowLime" cx="50%" cy="-5%" rx="80%" ry="110%">
            <Stop offset="0%" stopColor="rgb(163,230,53)" stopOpacity={0.11} />
            <Stop offset="52%" stopColor="rgb(163,230,53)" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="homeGlowCyan" cx="95%" cy="95%" rx="65%" ry="70%">
            <Stop offset="0%" stopColor="#00B6D7" stopOpacity={0.13} />
            <Stop offset="55%" stopColor="#00B6D7" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#homeGlowLime)" />
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#homeGlowCyan)" />
      </Svg>

      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: topPad }]}>
        <Image
          source={require("@/assets/images/central_studio_logo.png")}
          style={s.logo}
          resizeMode="contain"
        />
        <View style={s.headerRight}>
          {/* Bell */}
          <BellButton hasUnread={totalUnread > 0} onPress={() => router.push("/notifications")} />
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
              : <CsIcon name="user" size={18} color={INK_300} />}
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
              <CsIcon name="chevron" size={15} stroke={2.4} color={INK_300} />
            </TouchableOpacity>
          </View>
          {instLoading ? (
            <FlatList
              data={[1, 2, 3, 4]} keyExtractor={(i) => String(i)}
              renderItem={() => <InstructorCardSkeleton />}
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingLeft: 20, gap: 14 }}
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
              contentContainerStyle={{ paddingLeft: 20, gap: 14, paddingRight: 20 }}
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
              <CsIcon name="chevron" size={15} stroke={2.4} color={INK_300} />
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
            <View style={s.emptyState}>
              <View style={s.emptyIconCircle}>
                <CsIcon name="calendar" size={36} stroke={1.8} color={CYAN} />
              </View>
              <Text style={s.emptyTitle}>No upcoming classes</Text>
              <Text style={s.emptyDesc}>Classes will appear here once schedules are set up in the portal.</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              {weekClasses.map((cls) => (
                <ClassCard
                  key={`${cls.id}-${cls.date}`}
                  item={cls}
                  instructorMap={instructorMap}
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
    </Animated.View>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // ── Screen ────────────────────────────────────────────────────────────────
  screen: { flex: 1, backgroundColor: INK_900 },
  bgGlow: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, pointerEvents: "none" as any },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingBottom: 14, zIndex: 1,
  },
  // Design: width 100, height 63
  logo: { width: 100, height: 63 },
  headerRight: { flexDirection: "row", gap: 12, alignItems: "center" },
  bellWrap: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  // magenta halo behind the bell (design bellGlow) — sits outside the button
  bellGlow: { position: "absolute", width: 58, height: 58, borderRadius: 29, backgroundColor: MAGENTA },
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
  // Fix Pack 2: marginBottom 24→30, sectionHeader marginBottom 12→14
  section: { marginBottom: 30 },
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "flex-end", paddingHorizontal: 20, marginBottom: 14,
  },
  eyebrow: {
    fontSize: 10, fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.8, color: CYAN,
    textTransform: "uppercase", marginBottom: 3,
  },
  // Fix Pack 2: Archivo_800ExtraBold (was 700Bold), letterSpacing -0.24 (was -0.3)
  sectionTitle: { fontSize: 24, fontFamily: "Archivo_800ExtraBold", color: "#fff", letterSpacing: -0.24, lineHeight: 28 },
  seeAllRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  seeAllText: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: INK_300 },

  // ── Hero wrap ──────────────────────────────────────────────────────────────
  // Fix Pack 2: marginBottom 22→30
  heroWrap: { marginBottom: 30, overflow: "visible" as any },
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
  // Design: role-eyebrow — Fix Pack 2: fontSize 9→12, letterSpacing 1.8→1.92
  heroEyebrow: { fontSize: 12, fontFamily: "SpaceMono_700Bold", color: CYAN, letterSpacing: 1.92, textTransform: "uppercase", marginBottom: 7 },
  // Design: font-display, fontSize: 36 — Fix Pack 2: lineHeight 32→33 (36×0.9=32.4 → round up)
  heroTitle: { fontSize: 36, fontFamily: "Anton_400Regular", color: "#fff", lineHeight: 33, textTransform: "uppercase", letterSpacing: 0 },
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
  heroSubtitle: { fontSize: 12, fontFamily: "Archivo_400Regular", color: INK_200 },
  // Dots — Fix Pack 2: marginTop 12→14, dot height 5→6, borderRadius 2.5→3
  heroDots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 14 },
  heroDot: { height: 6, borderRadius: 3 },

  // ── Instructor cards ───────────────────────────────────────────────────────
  // Design: width=132, height=168
  instCard: { width: 132, height: 168, borderRadius: R_MD, overflow: "hidden", backgroundColor: INK_800 },
  // Fix Pack 2: badge position top 8→9, left 8→9; letterSpacing 1→0.8
  instBadge: {
    position: "absolute", top: 9, left: 9,
    backgroundColor: "rgba(0,182,215,0.92)",
    borderRadius: R_PILL, paddingHorizontal: 7, paddingVertical: 3,
    maxWidth: 90,
  },
  instBadgeText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", color: INK_900, textTransform: "uppercase", letterSpacing: 0.8 },
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
  // Fix Pack 2: backgroundColor rgb(0,0,0)→INK_800 (#15171B)
  classCard: {
    borderRadius: R_LG, overflow: "hidden",
    backgroundColor: INK_800,
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
  // Body — Fix Pack 2: paddingBottom 12→16, gap 10→11
  classBody: { padding: 15, paddingBottom: 16, gap: 11 },
  classTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  // Fix Pack 2: classTitle fontSize 18→20; classDesc fontSize 13→14, lineHeight 19→22
  classTitle: { fontSize: 20, fontFamily: "Archivo_700Bold", color: "#fff", lineHeight: 22, marginBottom: 3 },
  classDesc: { fontSize: 14, fontFamily: "Archivo_400Regular", color: INK_300, lineHeight: 22 },
  classPrice: { fontSize: 20, fontFamily: "Anton_400Regular", color: CYAN, lineHeight: 22, flexShrink: 0 },
  classMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  classMetaText: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: INK_300 },
  classMetaSep: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: INK_400 },
  classDiv: { height: 1, backgroundColor: "rgba(255,255,255,0.07)", marginHorizontal: 0 },
  // Footer: design has InstructorTag left + BookButton right.
  // Proportional (responsive): in the design the Book button is ~54% of the
  // footer width and the instructor tag ~43% (gap ~10). We reproduce that ratio
  // with flex instead of fixed px so it holds across phone sizes.
  classFooter: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 15, paddingVertical: 12, gap: 12,
  },
  instTag: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  instTagAvatar: {
    width: 30, height: 30, borderRadius: 15,
    overflow: "hidden", alignItems: "center", justifyContent: "center",
    backgroundColor: CYAN + "22",
  },
  instTagImage: { width: "100%", height: "100%" },
  instTagInitials: { fontSize: 10, fontFamily: "Archivo_700Bold", color: CYAN },
  instTagName: { flex: 1, fontSize: 12, fontFamily: "Archivo_600SemiBold", color: INK_200 },
  // Book button — design parity (home-feed.jsx BookButton, standard layout).
  // Responsive: flex 1.3 vs the instructor tag's flex 1 reproduces the design's
  // ~54/43 width split on any phone (instead of a hardcoded 174px). Fixed
  // height/typography keep it visually identical across devices.
  bookBtn: {
    flex: 1.3, paddingVertical: 10, paddingHorizontal: 16, borderRadius: R_MD,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  bookBtnText: { fontSize: 14, fontFamily: "Archivo_800ExtraBold" },

  // ── Empty state — Fix Pack 2: redesigned to match design spec ────────────
  // Design: 84px circular icon container, no dashed card, title 26px, body 16px
  emptyState: {
    marginHorizontal: 20, paddingVertical: 32,
    alignItems: "center", gap: 16,
  },
  emptyIconCircle: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: CYAN + "12",
    borderWidth: 1, borderColor: CYAN + "28",
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { fontSize: 26, fontFamily: "Archivo_800ExtraBold", color: "#fff", textAlign: "center", letterSpacing: -0.3 },
  emptyDesc: { fontSize: 16, fontFamily: "Archivo_400Regular", color: INK_300, textAlign: "center", lineHeight: 24, maxWidth: 280 },

  // ── Package cards — Fix Pack 2: width 200→230; hot border full cyan, 1.5px ──
  pkgCard: {
    width: 230, borderRadius: R_LG, overflow: "hidden",
    backgroundColor: INK_800, borderWidth: 1, borderColor: BORDER, padding: 18,
  },
  // Fix Pack 2: borderColor CYAN+"60"→CYAN (full opacity), borderWidth 1→1.5
  pkgCardHot: { borderColor: CYAN, borderWidth: 1.5, backgroundColor: "rgba(0,182,215,0.08)" },
  pkgBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start", backgroundColor: CYAN,
    borderRadius: R_PILL, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 10,
  },
  // Fix Pack 2: pkgBadgeText fontSize 8→11
  pkgBadgeText: { fontSize: 11, fontFamily: "Archivo_800ExtraBold", color: INK_900, letterSpacing: 1 },
  pkgIcon: {
    width: 40, height: 40, borderRadius: R_MD,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  // Fix Pack 2: pkgName fontSize 17→19; pkgPrice fontSize 32→38, lineHeight 30→34
  pkgName: { fontSize: 19, fontFamily: "Archivo_700Bold", color: "#fff", marginBottom: 6 },
  pkgPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 4 },
  pkgPrice: { fontSize: 38, fontFamily: "Anton_400Regular", color: CYAN, lineHeight: 34 },
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

  // ── Reels — Fix Pack 2: 9:16 aspect ratio (120×213); play button 36→30 ───
  reelCard: {
    width: REEL_W, height: REEL_H, borderRadius: R_MD, overflow: "hidden",
    backgroundColor: INK_700, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: BORDER,
  },
  reelPlayBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.50)",
    alignItems: "center", justifyContent: "center",
  },
});
