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
import {
  DanceClass,
  Instructor,
} from "@/data/mockData";
import { useListHeroItems, useListInstructors, useListSchedules, useListClasses, useListPricePackages, customFetch } from "@workspace/api-client-react";
import type { HeroItem, Notification as ApiNotification, PricePackage } from "@workspace/api-client-react";
import { compareSchedulesByNextOccurrence, mapApiClassWithScheduleToMobile, mapApiInstructorToMobile } from "@/data/apiAdapters";
import { formatCairoDateKey, getCairoTomorrowDateKey } from "@/utils/cairoDate";
import colors from "@/constants/colors";
import NewStudentBanner from "@/components/NewStudentBanner";
import { InstructorCardSkeleton, ClassListCardSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";
import { DEFAULT_SINGLE_CLASS_PRICE_EGP, fetchClassPricing } from "@/services/classPricingService";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const NOTIF_ICON_MAP: Record<string, string> = {
  booking: "calendar",
  class_reminder: "time",
  package: "card",
  ballet: "diamond",
  offer: "pricetag",
  system: "information-circle",
};

// ─── Hero Carousel ────────────────────────────────────────────────────────────

const HERO_HEIGHT = 220;
const HERO_MARGIN = 20;
const HERO_WIDTH = SCREEN_WIDTH - HERO_MARGIN * 2;

/** Single slide inside the carousel */
function HeroSlide({ item, onInteract }: { item: HeroItem; onInteract?: () => void }) {
  return (
    <View style={styles.heroSlide}>
      <Image
        source={{ uri: item.imageUrl }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <LinearGradient
        colors={["rgba(0,0,0,0.05)", "rgba(0,0,0,0.45)", "rgba(0,0,0,0.88)"]}
        locations={[0, 0.45, 1]}
        style={styles.heroBannerGradient}
      >
        {item.tagline ? (
          <Text style={styles.heroBannerTagline}>{item.tagline.toUpperCase()}</Text>
        ) : null}
        <Text style={styles.heroBannerTitle}>{item.title}</Text>
        <TouchableOpacity
          onPress={() => {
            onInteract?.();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(item.buttonRoute as any);
          }}
          style={styles.heroBannerBtn}
        >
          <Text style={styles.heroBannerBtnText}>{item.buttonText}</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.studio.background} />
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
}

/** Skeleton placeholder shown while hero data is loading from the backend */
function HeroSkeleton() {
  return (
    <View style={[styles.heroBanner, styles.heroSkeletonBg]}>
      <View style={styles.heroSkeletonContent}>
        <View style={styles.heroSkeletonTagline} />
        <View style={styles.heroSkeletonTitle} />
        <View style={styles.heroSkeletonBtn} />
      </View>
    </View>
  );
}

interface HeroCarouselProps {
  items: HeroItem[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * Hero section — data comes exclusively from the backend.
 * No static fallback, no hardcoded content.
 */
function HeroCarousel({ items, isLoading, isError, error, onRetry }: HeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<HeroItem>>(null);
  const activeIndexRef = useRef(0);
  const autoRotateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoRotateTimer = useCallback(() => {
    if (autoRotateTimerRef.current) {
      clearInterval(autoRotateTimerRef.current);
      autoRotateTimerRef.current = null;
    }
  }, []);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const scrollToHeroIndex = useCallback((index: number, animated = true) => {
    if (!items.length) return;
    const nextIndex = ((index % items.length) + items.length) % items.length;
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
    listRef.current?.scrollToIndex({ index: nextIndex, animated });
  }, [items.length]);

  const startAutoRotate = useCallback(() => {
    clearAutoRotateTimer();
    if (items.length <= 1) return;

    autoRotateTimerRef.current = setInterval(() => {
      scrollToHeroIndex(activeIndexRef.current + 1);
    }, 5000);
  }, [clearAutoRotateTimer, items.length, scrollToHeroIndex]);

  const pauseAutoRotate = useCallback(() => {
    clearAutoRotateTimer();
    clearResumeTimer();
    if (items.length <= 1) return;

    resumeTimerRef.current = setTimeout(() => {
      startAutoRotate();
    }, 20000);
  }, [clearAutoRotateTimer, clearResumeTimer, items.length, startAutoRotate]);

  useEffect(() => {
    activeIndexRef.current = 0;
    setActiveIndex(0);
    clearResumeTimer();
    startAutoRotate();

    return () => {
      clearAutoRotateTimer();
      clearResumeTimer();
    };
  }, [clearAutoRotateTimer, clearResumeTimer, items.length, startAutoRotate]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / HERO_WIDTH);
    activeIndexRef.current = idx;
    setActiveIndex(idx);
  };

  if (isLoading) {
    return <HeroSkeleton />;
  }

  if (isError) {
    return (
      <View style={[styles.heroBanner, styles.heroStateBg]}>
        {isOfflineError(error) ? (
          <OfflineState variant="compact" onRetry={onRetry} />
        ) : (
          <ErrorState variant="compact" onRetry={onRetry} message="Couldn't load featured content." />
        )}
      </View>
    );
  }

  if (!items.length) {
    return null;
  }

  if (items.length === 1) {
    return (
      <View style={styles.heroBanner}>
        <HeroSlide item={items[0]} />
      </View>
    );
  }

  return (
    <View style={styles.heroBanner}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(i) => String(i.id)}
        renderItem={({ item }) => <HeroSlide item={item} onInteract={pauseAutoRotate} />}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={pauseAutoRotate}
        onMomentumScrollEnd={onScroll}
        getItemLayout={(_, index) => ({ length: HERO_WIDTH, offset: HERO_WIDTH * index, index })}
        snapToInterval={HERO_WIDTH}
        decelerationRate="fast"
        bounces={false}
        style={styles.heroCarouselList}
      />
      {/* Pagination dots */}
      <View style={styles.heroDots}>
        {items.map((_, i) => (
          <TouchableOpacity
            key={i}
            style={styles.heroDotButton}
            activeOpacity={0.8}
            onPress={() => {
              pauseAutoRotate();
              scrollToHeroIndex(i);
            }}
          >
            <View
              style={[
                styles.heroDot,
                i === activeIndex
                  ? { backgroundColor: colors.studio.primary, width: 22 }
                  : { backgroundColor: "rgba(255,255,255,0.3)", width: 6 },
              ]}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Instagram Reels Section ──────────────────────────────────────────────────

const REEL_CARD_WIDTH  = 120;
const REEL_CARD_HEIGHT = 210;

interface InstagramReel {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

function AutoPlayReelCard({
  reel,
  onPress,
}: {
  reel: InstagramReel;
  onPress: () => void;
}) {
  const player = useVideoPlayer(reel.media_url ?? "", (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    return () => {
      player.release();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TouchableOpacity style={styles.reelCard} activeOpacity={0.82} onPress={onPress}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <View style={[styles.reelPlayBtn, { backgroundColor: "rgba(0,0,0,0.30)" }]}>
        <Ionicons name="logo-instagram" size={18} color="#FFFFFF" />
      </View>
    </TouchableOpacity>
  );
}

function ReelsSection() {
  const { data, isLoading, isError } = useQuery<{ reels: InstagramReel[] }>({
    queryKey: ["instagram-reels"],
    queryFn: async () => {
      const result = await customFetch("/api/instagram/reels");
      return result as { reels: InstagramReel[] };
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const reels = data?.reels ?? [];

  const [autoPlayActive, setAutoPlayActive] = useState(false);
  const autoPlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reels.length > 0 && !autoPlayActive) {
      setAutoPlayActive(true);
      autoPlayTimer.current = setTimeout(() => {
        setAutoPlayActive(false);
      }, 5000);
    }
    return () => {
      if (autoPlayTimer.current) clearTimeout(autoPlayTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reels.length]);

  if (isError || (!isLoading && reels.length === 0)) return null;

  return (
    <View style={[styles.section, { marginBottom: 8 }]}>
      <View style={styles.sectionHeader}>
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Ionicons name="logo-instagram" size={14} color={colors.studio.primary} />
            <Text style={[styles.sectionEyebrow, { color: colors.studio.primary }]}>@CENTRAL.STUDIO.EG</Text>
          </View>
          <Text style={styles.sectionTitle}>Latest Reels</Text>
        </View>
        <TouchableOpacity
          onPress={() => Linking.openURL("https://www.instagram.com/central.studio.eg/")}
          style={styles.seeAllBtn}
        >
          <Text style={[styles.seeAll, { color: colors.studio.primary }]}>Follow</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.studio.primary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <FlatList
          data={[1, 2, 3, 4]}
          keyExtractor={(i) => String(i)}
          renderItem={() => <View style={styles.reelCardSkeleton} />}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: 20, gap: 10, paddingRight: 8 }}
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

            if (index === 0 && autoPlayActive && item.media_url) {
              return <AutoPlayReelCard reel={item} onPress={handlePress} />;
            }

            return (
              <TouchableOpacity
                style={styles.reelCard}
                activeOpacity={0.82}
                onPress={handlePress}
              >
                {item.thumbnail_url ? (
                  <Image
                    source={{ uri: item.thumbnail_url }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                  />
                ) : (
                  <LinearGradient
                    colors={["#1E1E26", "#0D0D14"]}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                <View style={styles.reelPlayBtn}>
                  <Ionicons name="play" size={20} color="#FFFFFF" />
                </View>
              </TouchableOpacity>
            );
          }}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: 20, gap: 10, paddingRight: 20 }}
        />
      )}
    </View>
  );
}

// ─── Instructor Card ──────────────────────────────────────────────────────────

function InstructorCard({ instructor }: { instructor: Instructor }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [instructor.photoUrl]);

  return (
    <TouchableOpacity
      style={styles.instructorCard}
      activeOpacity={0.85}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/instructor/[id]", params: { id: instructor.id } });
      }}
    >
      {instructor.photoUrl && !imageFailed ? (
        <Image
          source={{ uri: instructor.photoUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <LinearGradient
          colors={[colors.studio.primary + "DD", colors.studio.primary + "44", "#0B0B12"]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        >
          <View style={styles.instructorInitialsBg}>
            <Text style={[styles.instructorInitials, { color: colors.studio.primary }]}>
              {instructor.initials}
            </Text>
          </View>
        </LinearGradient>
      )}
      {/* Style badge at top-left */}
      {instructor.title ? (
        <View style={styles.instructorStyleBadge}>
          <Text style={styles.instructorStyleBadgeText} numberOfLines={1}>{instructor.title}</Text>
        </View>
      ) : null}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.92)"]}
        style={styles.instructorOverlay}
      >
        <Text style={styles.instructorName} numberOfLines={1}>{instructor.name}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Class Card ───────────────────────────────────────────────────────────────

function ClassListCard({
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
  const isBookable = hasSchedule && item.status !== "full";
  const canUsePackageCredits = item.packageEligible !== false && packageCreditsRemaining > 0;

  const today = formatCairoDateKey();
  const tomorrowStr = getCairoTomorrowDateKey();

  const dayLabel =
    item.date === today ? "Today" :
    item.date === tomorrowStr ? "Tomorrow" :
    item.dayOfWeek;

  const statusColor =
    !hasSchedule ? "#6B7280" :
    item.status === "available" ? colors.success :
    item.status === "fewSeats" ? colors.warning :
    item.status === "full" ? colors.error : "#8B5CF6";

  const statusLabel =
    !hasSchedule ? "No schedule" :
    item.status === "available" ? "Available" :
    item.status === "fewSeats" ? `${available} left` :
    item.status === "full" ? "Full" : "Waitlist";

  const levelColor =
    item.level === "Beginner" ? colors.studio.primary :
    item.level === "Intermediate" ? colors.warning :
    item.level === "Advanced" ? "#C084FC" :
    "#9CA3AF";

  return (
    <TouchableOpacity
      style={styles.classCard}
      activeOpacity={0.88}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/class/[id]", params: { id: item.id, scheduleId: item.scheduleId } });
      }}
    >
      {/* Image header (shown when photoUrl exists from Google Drive) */}
      {item.photoUrl ? (
        <View style={styles.classCardImageWrap}>
          <Image
            source={{ uri: item.photoUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          <LinearGradient
            colors={["rgba(6,12,16,0.08)", "rgba(6,12,16,0.65)"]}
            style={StyleSheet.absoluteFill}
          />
          {/* Chips floating on image */}
          <View style={styles.classCardChipsRow}>
            <View style={[styles.levelChip, { borderColor: levelColor }]}>
              <Text style={[styles.levelChipText, { color: levelColor }]}>{item.ageGroup}</Text>
            </View>
            <View style={[styles.statusChip, { backgroundColor: statusColor + "28" }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusChipText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          </View>
        </View>
      ) : (
        /* No image — show compact chips bar */
        <View style={styles.classCardTopBar}>
          <View style={[styles.levelChip, { borderColor: levelColor }]}>
            <Text style={[styles.levelChipText, { color: levelColor }]}>{item.ageGroup}</Text>
          </View>
          <View style={[styles.statusChip, { backgroundColor: statusColor + "28" }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusChipText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
      )}

      {/* Body */}
      <View style={styles.classCardBody}>
        <View style={styles.classCardLeft}>
          <Text style={styles.classCardTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.classCardDesc} numberOfLines={2}>{item.description}</Text>

          <View style={styles.classCardInstructorRow}>
            <View style={styles.instructorMiniAvatar}>
              {instructor?.photoUrl ? (
                <Image source={{ uri: instructor.photoUrl }} style={styles.instructorMiniImage} />
              ) : (
                <Text style={[styles.instructorMiniInitials, { color: colors.studio.primary }]}>
                  {instructor?.initials ?? "?"}
                </Text>
              )}
            </View>
            <Text style={styles.classCardInstructorName}>{instructor?.name ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.classCardRight}>
          <Text style={styles.classCardDayLabel}>{dayLabel}</Text>
          <Text style={[styles.classCardTime, { color: colors.studio.primary }]}>{item.startTime}</Text>
          <Text style={styles.classCardDuration}>{item.duration}</Text>
        </View>
      </View>

      {/* Divider */}
      <View style={styles.classCardDivider} />

      {/* Footer */}
      <View style={styles.classCardFooter}>
        <Text style={[styles.classCardPrice, { color: colors.studio.primary }]}>
          {item.price > 0 ? `EGP ${item.price}` : "Price TBC"}
        </Text>
        <View style={styles.classCardBtns}>
          {canUsePackageCredits && (
            <TouchableOpacity
              onPress={() => {
                if (!isBookable) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/booking/flow", params: { classId: item.id, scheduleId: item.scheduleId, usePackage: "true" } });
              }}
              disabled={!isBookable}
              style={[
                styles.classPackageBtn,
                !isBookable && styles.classBtnDisabled,
              ]}
            >
              <Text style={[styles.classPackageBtnText, { color: isBookable ? colors.studio.primary : "#6B7280" }]}>
                Package · {packageCreditsRemaining} cr
              </Text>
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
              styles.classBookBtn,
              isBookable
                ? { backgroundColor: colors.studio.primary }
                : { backgroundColor: "#1E2E38" },
            ]}
          >
            <Text style={[styles.classBookBtnText, { color: isBookable ? colors.studio.background : "#6B7280" }]}>
              {item.status === "full" ? "Waitlist" : isBookable ? "Book" : "N/A"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Packages Section ─────────────────────────────────────────────────────────

function PackageCard({ pkg }: { pkg: PricePackage }) {
  const isFeatured = pkg.isFeatured;
  const credits = pkg.sessions ?? 1;
  const perClass = pkg.singleClassPriceEgp ?? (credits > 0 ? Math.round(pkg.priceEgp / credits) : 0);

  return (
    <TouchableOpacity
      style={[styles.pkgCard, isFeatured && styles.pkgCardFeatured]}
      activeOpacity={0.88}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push("/(tabs)/packages");
      }}
    >
      {isFeatured && (
        <View style={styles.pkgPopularBadge}>
          <Text style={styles.pkgPopularBadgeText}>POPULAR</Text>
        </View>
      )}
      <View style={[styles.pkgIconWrap, isFeatured && { backgroundColor: colors.studio.primary + "22" }]}>
        <Ionicons
          name={isFeatured ? "star" : credits === 1 ? "ticket-outline" : "infinite-outline"}
          size={22}
          color={isFeatured ? colors.studio.primary : "#6B7280"}
        />
      </View>
      <Text style={styles.pkgName}>{pkg.name}</Text>
      <View style={styles.pkgPriceRow}>
        <Text style={[styles.pkgPrice, isFeatured && { color: "#fff" }]}>EGP {pkg.priceEgp}</Text>
        <Text style={styles.pkgUnit}>/ {credits === 1 ? "class" : `${credits} classes`}</Text>
      </View>
      {perClass > 0 && credits > 1 && (
        <Text style={styles.pkgPerClass}>EGP {perClass} per class</Text>
      )}
      <View style={[styles.pkgChooseBtn, isFeatured && { backgroundColor: colors.studio.primary }]}>
        <Text style={[styles.pkgChooseBtnText, isFeatured && { color: colors.studio.background }]}>
          Choose
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function PackagesSection() {
  const { data: apiPackages, isLoading, isError } = useListPricePackages();
  const packages = React.useMemo(
    () => (apiPackages ?? []).filter((p: PricePackage) => p.isActive !== false),
    [apiPackages],
  );

  if (isError || (!isLoading && packages.length === 0)) {
    // Fallback to compact promo banner
    return (
      <View style={[styles.packagesPromo, { borderColor: colors.studio.primary + "30", marginHorizontal: 20 }]}>
        <LinearGradient colors={["#003A47", "#001828"]} style={styles.packagesPromoInner}>
          <View style={[styles.packagesPromoIcon, { backgroundColor: colors.studio.primary + "20" }]}>
            <Ionicons name="card" size={26} color={colors.studio.primary} />
          </View>
          <View style={styles.packagesPromoText}>
            <Text style={styles.packagesPromoTitle}>Save with Class Packages</Text>
            <Text style={styles.packagesPromoDesc}>Buy 4, 8, or 12 classes — any style, 6-month validity</Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/(tabs)/packages");
            }}
            style={[styles.packagesPromoBtn, { backgroundColor: colors.studio.primary }]}
          >
            <Text style={styles.packagesPromoBtnText}>View</Text>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={[styles.sectionEyebrow, { color: colors.studio.primary }]}>SAVE MORE, DANCE MORE</Text>
          <Text style={styles.sectionTitle}>Packages</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/(tabs)/packages")}
          style={styles.seeAllBtn}
        >
          <Text style={[styles.seeAll, { color: colors.studio.primary }]}>Compare</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.studio.primary} />
        </TouchableOpacity>
      </View>
      {isLoading ? (
        <View style={{ paddingLeft: 20, flexDirection: "row", gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={[styles.pkgCard, { opacity: 0.4 }]} />
          ))}
        </View>
      ) : (
        <FlatList
          data={packages}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => <PackageCard pkg={item} />}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: 20, gap: 12, paddingRight: 20 }}
        />
      )}
    </View>
  );
}

// AsyncStorage key shared with notifications.tsx for tracking read API notification IDs
const API_NOTIF_READ_KEY = "api_notif_read_ids";

export default function StudioHomeScreen() {
  const { user, unreadNotifications, bookings, newStudentBannerDismissed, dismissNewStudentBanner, userPackages } = useAppContext();
  const showNewStudentBanner = bookings.length === 0 && !newStudentBannerDismissed;
  const insets = useSafeAreaInsets();
  const userInitials = React.useMemo(() => {
    if (!user?.fullName) return "";
    return user.fullName
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [user?.fullName]);
  const packageCreditsRemaining = React.useMemo(
    () => userPackages
      .filter((pkg) => pkg.status === "active" && pkg.remainingCredits > 0)
      .reduce((sum, pkg) => sum + pkg.remainingCredits, 0),
    [userPackages],
  );

  // ── API unread notification count (for bell badge) ─────────────────────────
  const [apiUnreadCount, setApiUnreadCount] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    async function refreshApiUnread() {
      try {
        const [notifs, raw] = await Promise.all([
          customFetch<ApiNotification[]>("/api/notifications/my"),
          AsyncStorage.getItem(API_NOTIF_READ_KEY),
        ]);
        if (!active) return;
        const readIds = raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
        const count = notifs.filter((n) => !n.isDraft && !readIds.has(`api-${n.id}`)).length;
        setApiUnreadCount(count);
      } catch {
        // Silently ignore — badge just shows local count on error
      }
    }
    refreshApiUnread();
    return () => { active = false; };
  }, []));
  const totalUnreadNotifications = unreadNotifications + apiUnreadCount;
  const notificationBadgeLabel = totalUnreadNotifications > 99 ? "99+" : String(totalUnreadNotifications);

  // ── Hero items ─────────────────────────────────────────────────────────────
  const {
    data: allHeroItems,
    refetch: refetchHero,
    isLoading: isLoadingHero,
    isError: isErrorHero,
    error: heroError,
  } = useListHeroItems();
  const heroItems: HeroItem[] = React.useMemo(
    () => (allHeroItems ?? []).filter((i) => i.isActive),
    [allHeroItems]
  );

  // ── Live instructors ───────────────────────────────────────────────────────
  const {
    data: apiInstructors,
    refetch: refetchInstructors,
    isRefetching: isRefetchingInstructors,
    isLoading: isLoadingInstructors,
    isError: isErrorInstructors,
    error: instructorsError,
  } = useListInstructors();
  const instructors: Instructor[] = React.useMemo(
    () => (apiInstructors ?? []).filter((i) => i.isActive).map(mapApiInstructorToMobile),
    [apiInstructors]
  );

  const instructorMap = React.useMemo(() => {
    const m = new Map<string, Instructor>();
    instructors.forEach((i) => m.set(i.id, i));
    return m;
  }, [instructors]);

  // ── Live upcoming classes ──────────────────────────────────────────────────
  const {
    data: apiSchedules,
    refetch: refetchSchedules,
    isRefetching: isRefetchingSchedules,
    isLoading: isLoadingSchedules,
    isError: isErrorSchedules,
    error: schedulesError,
  } = useListSchedules();
  const {
    data: apiClasses,
    refetch: refetchClasses,
    isRefetching: isRefetchingClasses,
    isLoading: isLoadingClasses,
  } = useListClasses();
  const classPricingQuery = useQuery({
    queryKey: ["class-pricing"],
    queryFn: fetchClassPricing,
    staleTime: 5 * 60 * 1000,
  });
  const singleClassPriceEgp =
    classPricingQuery.data?.singleClassPriceEgp ?? DEFAULT_SINGLE_CLASS_PRICE_EGP;

  const isLoadingWeekClasses = isLoadingSchedules || isLoadingClasses;
  const isErrorWeekClasses = isErrorSchedules;
  const weekClassesError = schedulesError;

  const isRefreshing = isRefetchingInstructors || isRefetchingSchedules || isRefetchingClasses;
  const onRefresh = useCallback(() => {
    refetchHero();
    refetchInstructors();
    refetchSchedules();
    refetchClasses();
  }, [refetchHero, refetchInstructors, refetchSchedules, refetchClasses]);

  const weekClasses = React.useMemo<DanceClass[]>(() => {
    if (!apiSchedules?.length || !apiClasses?.length) {
      return [];
    }

    const classMap = new Map(apiClasses.map((c) => [c.id, c]));

    const result = [...apiSchedules]
      .sort((a, b) => compareSchedulesByNextOccurrence(a, b))
      .map((sched) => {
        const cls = classMap.get(sched.classId);
        if (!cls || !cls.isActive) return null;

        const mapped = mapApiClassWithScheduleToMobile(cls, sched, singleClassPriceEgp);
        if (mapped.isBallet) return null;
        return mapped;
      })
      .filter((item): item is DanceClass => item !== null);

    const deduped: DanceClass[] = [];
    for (const mapped of result) {
      const key = `${mapped.id}-${mapped.scheduleId ?? mapped.date}`;
      if (!deduped.some((r) => `${r.id}-${r.scheduleId ?? r.date}` === key)) {
        deduped.push(mapped);
      }
    }

    function parseDisplayTime(t: string): number {
      const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!m) return 0;
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
      if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
      return h * 60 + min;
    }

    return deduped.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return parseDisplayTime(a.startTime) - parseDisplayTime(b.startTime);
    }).slice(0, 5);
  }, [apiSchedules, apiClasses, singleClassPriceEgp]);

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 20 : insets.top + 12 }]}>
        <Image
          source={require("@/assets/images/central_studio_logo.png")}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <View style={styles.headerActions}>
          {/* Bell first (matches design order) */}
          <TouchableOpacity
            onPress={() => router.push("/notifications")}
            style={styles.headerIconBtn}
          >
            <Ionicons name="notifications-outline" size={21} color="#D1D5DB" />
            {totalUnreadNotifications > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{notificationBadgeLabel}</Text>
              </View>
            )}
          </TouchableOpacity>
          {/* Avatar */}
          <TouchableOpacity
            onPress={() => router.push(user ? "/(tabs)/profile" : "/auth/login")}
            style={styles.headerAvatarBtn}
            activeOpacity={0.82}
          >
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.headerAvatarImage} resizeMode="cover" />
            ) : userInitials ? (
              <Text style={styles.headerAvatarInitials}>{userInitials}</Text>
            ) : (
              <Ionicons name="person-outline" size={20} color="#9CA3AF" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 120 : 90 }]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.studio.primary}
            colors={[colors.studio.primary]}
          />
        }
      >
        {showNewStudentBanner && <NewStudentBanner onDismiss={dismissNewStudentBanner} />}

        {/* Hero */}
        <HeroCarousel
          items={heroItems}
          isLoading={isLoadingHero}
          isError={isErrorHero}
          error={heroError}
          onRetry={refetchHero}
        />

        {/* Instructors */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>LEARN FROM THE BEST</Text>
              <Text style={styles.sectionTitle}>Instructors</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/classes")}
              style={styles.seeAllBtn}
            >
              <Text style={[styles.seeAll, { color: colors.studio.primary }]}>See all</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.studio.primary} />
            </TouchableOpacity>
          </View>
          {isLoadingInstructors ? (
            <FlatList
              data={[1, 2, 3, 4]}
              keyExtractor={(i) => String(i)}
              renderItem={() => <InstructorCardSkeleton />}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingLeft: 20, gap: 12, paddingRight: 8 }}
              scrollEnabled={false}
            />
          ) : isErrorInstructors ? (
            isOfflineError(instructorsError) ? (
              <OfflineState variant="compact" onRetry={refetchInstructors} />
            ) : (
              <ErrorState variant="compact" onRetry={refetchInstructors} message="Couldn't load instructors." />
            )
          ) : (
            <FlatList
              data={instructors}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => <InstructorCard instructor={item} />}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingLeft: 20, gap: 12, paddingRight: 8 }}
            />
          )}
        </View>

        {/* Upcoming Classes */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>DON'T MISS OUT</Text>
              <Text style={styles.sectionTitle}>Upcoming Classes</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/classes")}
              style={styles.seeAllBtn}
            >
              <Text style={[styles.seeAll, { color: colors.studio.primary }]}>See all</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.studio.primary} />
            </TouchableOpacity>
          </View>

          {isLoadingWeekClasses ? (
            <View style={{ paddingHorizontal: 20, gap: 14 }}>
              {[1, 2, 3].map((i) => <ClassListCardSkeleton key={i} />)}
            </View>
          ) : isErrorWeekClasses ? (
            isOfflineError(weekClassesError) ? (
              <OfflineState variant="compact" onRetry={() => { refetchSchedules(); refetchClasses(); }} />
            ) : (
              <ErrorState variant="compact" onRetry={() => { refetchSchedules(); refetchClasses(); }} message="Couldn't load upcoming classes." />
            )
          ) : weekClasses.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="calendar-outline" size={34} color="#4B5563" />
              <Text style={styles.emptyTitle}>No upcoming scheduled classes</Text>
              <Text style={styles.emptyDesc}>Classes without schedules will appear after a day and time are added in the System Portal.</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 20, gap: 14 }}>
              {weekClasses.map((cls) => (
                <ClassListCard
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: colors.studio.background,
  },
  headerLogo: { width: 110, height: 50 },
  headerActions: { flexDirection: "row", gap: 10, alignItems: "center" },
  headerIconBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center", justifyContent: "center",
    overflow: "visible",
  },
  headerAvatarBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.studio.primary + "22",
    borderWidth: 2, borderColor: colors.studio.primary,
    alignItems: "center", justifyContent: "center",
    overflow: "hidden",
  },
  headerAvatarImage: { width: "100%", height: "100%" },
  headerAvatarInitials: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.studio.primary },
  notifBadge: {
    position: "absolute", top: -4, right: -4,
    minWidth: 17, height: 17, borderRadius: 9,
    backgroundColor: "#FF2E7E",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 3,
    zIndex: 10,
    elevation: 10,
    borderWidth: 1.5,
    borderColor: colors.studio.background,
  },
  notifBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#FFF" },

  scroll: { paddingTop: 6 },

  // ── Section headers ──────────────────────────────────────────────────────────
  section: { marginBottom: 30 },
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "flex-end", paddingHorizontal: 20, marginBottom: 14,
  },
  sectionEyebrow: {
    fontSize: 10, fontFamily: "Inter_700Bold",
    letterSpacing: 1.5, color: colors.studio.primary,
    textTransform: "uppercase", marginBottom: 4,
  },
  sectionTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF", letterSpacing: -0.3 },
  seeAllBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  seeAll: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // ── Hero ─────────────────────────────────────────────────────────────────────
  heroBanner: {
    marginHorizontal: HERO_MARGIN,
    borderRadius: 20, overflow: "hidden",
    marginBottom: 30, height: HERO_HEIGHT,
    backgroundColor: "#060C10",
  },
  heroSlide: { width: HERO_WIDTH, height: HERO_HEIGHT, overflow: "hidden", backgroundColor: "#060C10" },
  heroCarouselList: { borderRadius: 20, height: HERO_HEIGHT },
  heroDots: {
    position: "absolute", bottom: 12, left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7,
  },
  heroDotButton: { minWidth: 14, minHeight: 14, alignItems: "center", justifyContent: "center" },
  heroDot: { height: 6, borderRadius: 3 },
  heroBannerGradient: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 15, paddingBottom: 18,
    gap: 5,
  },
  heroBannerTagline: {
    fontSize: 10, fontFamily: "Inter_700Bold",
    color: colors.studio.primary, letterSpacing: 1.8, textTransform: "uppercase",
  },
  heroBannerTitle: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFFFFF", lineHeight: 34 },
  heroBannerBtn: {
    alignSelf: "flex-start",
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 50, marginTop: 4,
    backgroundColor: colors.studio.primary,
  },
  heroBannerBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.studio.background },
  heroSkeletonBg: { backgroundColor: "#14141C", justifyContent: "flex-end" },
  heroSkeletonContent: { padding: 20, gap: 10 },
  heroSkeletonTagline: { width: 130, height: 10, borderRadius: 5, backgroundColor: "#2A2A35" },
  heroSkeletonTitle: { width: "75%", height: 26, borderRadius: 8, backgroundColor: "#2A2A35" },
  heroSkeletonBtn: { width: 110, height: 36, borderRadius: 50, backgroundColor: "#2A2A35", marginTop: 4 },
  heroStateBg: { backgroundColor: "#0E1619", justifyContent: "center", alignItems: "center" },

  // ── Instructor cards ──────────────────────────────────────────────────────────
  instructorCard: {
    width: 130, height: 172,
    borderRadius: 14, overflow: "hidden",
    backgroundColor: "#1E1E26",
  },
  instructorStyleBadge: {
    position: "absolute", top: 9, left: 9,
    backgroundColor: colors.studio.primary + "E8",
    borderRadius: 50,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  instructorStyleBadgeText: {
    fontSize: 9, fontFamily: "Inter_700Bold",
    color: colors.studio.background, textTransform: "uppercase", letterSpacing: 0.5,
  },
  instructorInitialsBg: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: "center", justifyContent: "center",
    alignSelf: "center", marginTop: 36,
    backgroundColor: colors.studio.primary + "30",
  },
  instructorInitials: { fontSize: 20, fontFamily: "Inter_700Bold" },
  instructorOverlay: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 10, paddingBottom: 10, paddingTop: 30,
  },
  instructorName: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#FFFFFF" },

  // ── Class card ────────────────────────────────────────────────────────────────
  classCard: {
    borderRadius: 16, overflow: "hidden",
    backgroundColor: "#0A0F13",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  classCardImageWrap: {
    height: 130, position: "relative",
  },
  classCardChipsRow: {
    position: "absolute", top: 12, left: 12, right: 12,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  classCardTopBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  levelChip: {
    paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 50, borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  levelChipText: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  statusChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 50,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusChipText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  classCardBody: {
    flexDirection: "row", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, gap: 10,
  },
  classCardLeft: { flex: 1, gap: 5 },
  classCardTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF", lineHeight: 22 },
  classCardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", lineHeight: 17 },
  classCardInstructorRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2 },
  instructorMiniAvatar: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
    overflow: "hidden",
    backgroundColor: colors.studio.primary + "22",
  },
  instructorMiniImage: { width: "100%", height: "100%" },
  instructorMiniInitials: { fontSize: 10, fontFamily: "Inter_700Bold" },
  classCardInstructorName: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  classCardRight: { alignItems: "flex-end", justifyContent: "center", gap: 2, minWidth: 86 },
  classCardDayLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  classCardTime: { fontSize: 17, fontFamily: "Inter_700Bold" },
  classCardDuration: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280" },
  classCardDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.07)", marginHorizontal: 14 },
  classCardFooter: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 12,
  },
  classCardPrice: { fontSize: 16, fontFamily: "Inter_700Bold" },
  classCardBtns: { flexDirection: "row", alignItems: "center", gap: 8 },
  classPackageBtn: {
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1, borderColor: colors.studio.primary + "50",
    backgroundColor: colors.studio.primary + "10",
  },
  classPackageBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  classBookBtn: {
    paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: 10,
  },
  classBookBtnText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  classBtnDisabled: { opacity: 0.45 },

  // ── Empty state ───────────────────────────────────────────────────────────────
  emptyCard: {
    marginHorizontal: 20, borderRadius: 18, borderWidth: 1, borderStyle: "dashed",
    borderColor: colors.studio.border,
    padding: 32, alignItems: "center", gap: 10,
    backgroundColor: colors.studio.card,
  },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", textAlign: "center" },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 18 },

  // ── Package cards ─────────────────────────────────────────────────────────────
  pkgCard: {
    width: 200, borderRadius: 16, overflow: "hidden",
    backgroundColor: "#0E1619",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    padding: 18,
  },
  pkgCardFeatured: {
    borderColor: colors.studio.primary + "60",
    backgroundColor: "#062028",
  },
  pkgPopularBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.studio.primary,
    borderRadius: 50, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 10,
  },
  pkgPopularBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: colors.studio.background, letterSpacing: 0.5 },
  pkgIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 12,
  },
  pkgName: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: 6 },
  pkgPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 4 },
  pkgPrice: { fontSize: 24, fontFamily: "Inter_700Bold", color: colors.studio.primary },
  pkgUnit: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
  pkgPerClass: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#6B7280", marginBottom: 14 },
  pkgChooseBtn: {
    marginTop: "auto" as any,
    paddingVertical: 11, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  pkgChooseBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFFFFF" },

  // ── Packages promo fallback ───────────────────────────────────────────────────
  packagesPromo: {
    borderRadius: 16, borderWidth: 1, overflow: "hidden", marginBottom: 30,
  },
  packagesPromoInner: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 16,
  },
  packagesPromoIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  packagesPromoText: { flex: 1 },
  packagesPromoTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  packagesPromoDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2, lineHeight: 16 },
  packagesPromoBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  packagesPromoBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#000" },

  // ── Reels ─────────────────────────────────────────────────────────────────────
  reelCard: {
    width: REEL_CARD_WIDTH,
    height: REEL_CARD_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#1A1A24",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  reelCardSkeleton: {
    width: REEL_CARD_WIDTH,
    height: REEL_CARD_HEIGHT,
    borderRadius: 12,
    backgroundColor: "#1E1E26",
  },
  reelPlayBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.52)",
    alignItems: "center", justifyContent: "center",
    paddingLeft: 2,
  },
});
