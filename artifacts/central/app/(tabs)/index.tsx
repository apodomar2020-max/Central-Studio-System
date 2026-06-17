import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
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
import { useListHeroItems, useListInstructors, useListSchedules, useListClasses, customFetch } from "@workspace/api-client-react";
import type { HeroItem, Notification as ApiNotification } from "@workspace/api-client-react";
import { mapApiInstructorToMobile, mapScheduleAndClassToMobile } from "@/data/apiAdapters";
import colors from "@/constants/colors";
import NewStudentBanner from "@/components/NewStudentBanner";
import { InstructorCardSkeleton, ClassListCardSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";

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

const HERO_HEIGHT = 230;
const HERO_MARGIN = 16;
const HERO_WIDTH = SCREEN_WIDTH - HERO_MARGIN * 2;

/** Single slide inside the carousel */
function HeroSlide({ item }: { item: HeroItem }) {
  return (
    <View style={styles.heroSlide}>
      <Image
        source={{ uri: item.imageUrl }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <LinearGradient
        colors={["rgba(0,0,0,0.08)", "rgba(0,0,0,0.52)", "rgba(0,0,0,0.92)"]}
        locations={[0, 0.45, 1]}
        style={styles.heroBannerGradient}
      >
        {item.tagline ? (
          <Text style={styles.heroBannerTagline}>{item.tagline.toUpperCase()}</Text>
        ) : null}
        <Text style={styles.heroBannerTitle}>{item.title}</Text>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(item.buttonRoute as any);
          }}
          style={styles.heroBannerBtn}
        >
          <Text style={styles.heroBannerBtnText}>{item.buttonText}</Text>
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
 *
 * States:
 *   loading  → HeroSkeleton
 *   offline  → OfflineState (compact) inside hero frame
 *   error    → ErrorState (compact) inside hero frame
 *   empty    → section hidden (null)
 *   data     → carousel / single slide
 */
function HeroCarousel({ items, isLoading, isError, error, onRetry }: HeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / HERO_WIDTH);
    setActiveIndex(idx);
  };

  // Loading → skeleton (never static marketing content)
  if (isLoading) {
    return <HeroSkeleton />;
  }

  // Network or server error → show appropriate state inside the hero frame
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

  // Backend returned no active slides → hide section entirely
  if (!items.length) {
    return null;
  }

  // Single slide → no FlatList needed
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
        data={items}
        keyExtractor={(i) => String(i.id)}
        renderItem={({ item }) => <HeroSlide item={item} />}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        snapToInterval={HERO_WIDTH}
        decelerationRate="fast"
        bounces={false}
        style={{ borderRadius: 20 }}
      />
      {/* Pagination dots */}
      <View style={styles.heroDots}>
        {items.map((_, i) => (
          <View
            key={i}
            style={[
              styles.heroDot,
              i === activeIndex
                ? { backgroundColor: "#FFFFFF", width: 16 }
                : { backgroundColor: "rgba(255,255,255,0.4)", width: 6 },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function InstructorCard({ instructor }: { instructor: Instructor }) {
  return (
    <TouchableOpacity
      style={styles.instructorCard}
      activeOpacity={0.85}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/instructor/[id]", params: { id: instructor.id } });
      }}
    >
      {instructor.photoUrl ? (
        <Image
          source={{ uri: instructor.photoUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : (
        <LinearGradient
          colors={[colors.studio.primary + "DD", colors.studio.primary + "44", "#0B0B12"]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        >
          <View style={[styles.instructorInitialsBg, { backgroundColor: colors.studio.primary + "30" }]}>
            <Text style={[styles.instructorInitials, { color: colors.studio.primary }]}>
              {instructor.initials}
            </Text>
          </View>
        </LinearGradient>
      )}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.95)"]}
        style={styles.instructorOverlay}
      >
        <View style={styles.instructorInfoRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.instructorName} numberOfLines={1}>{instructor.name}</Text>
            <Text style={[styles.instructorRole, { color: colors.studio.primary }]} numberOfLines={1}>
              {instructor.title}
            </Text>
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

function ClassListCard({
  item,
  instructorMap,
}: {
  item: DanceClass;
  instructorMap?: Map<string, Instructor>;
}) {
  const instructor = instructorMap?.get(item.instructorId);
  const available = item.capacity - item.bookedCount;

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const dayLabel =
    item.date === today ? "Today" :
    item.date === tomorrowStr ? "Tomorrow" :
    item.dayOfWeek;

  const statusColor =
    item.status === "available" ? colors.studio.primary :
    item.status === "fewSeats" ? "#F59E0B" :
    item.status === "full" ? "#EF4444" : "#8B5CF6";

  const statusLabel =
    item.status === "available" ? "Available" :
    item.status === "fewSeats" ? `${available} left` :
    item.status === "full" ? "Full" : "Waitlist";

  const categoryColor = colors.studio.primary;

  return (
    <TouchableOpacity
      style={[styles.classCard, { borderColor: categoryColor + "35" }]}
      activeOpacity={0.88}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/class/[id]", params: { id: item.id } });
      }}
    >
      <View style={[styles.classCardTopBar, { backgroundColor: categoryColor + "10" }]}>
        <View style={[styles.categoryPill, { backgroundColor: categoryColor }]}>
          <Text style={styles.categoryPillText}>{item.ageGroup}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusColor + "25" }]}>
          <View style={[styles.statusDotSmall, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusPillText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.classCardBody}>
        <View style={styles.classCardLeft}>
          <Text style={[styles.classCardTitle, { color: categoryColor }]} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.classCardDesc} numberOfLines={2}>{item.description}</Text>

          <View style={styles.classCardInstructor}>
            <View style={[styles.instructorMiniAvatar, { backgroundColor: colors.studio.primary + "30" }]}>
              <Text style={[styles.instructorMiniInitials, { color: colors.studio.primary }]}>
                {instructor?.initials ?? "?"}
              </Text>
            </View>
            <Text style={styles.classCardInstructorLabel}>Instructor: </Text>
            <Text style={styles.classCardInstructorName}>{instructor?.name ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.classCardRight}>
          <Text style={styles.classCardDayLabel}>{dayLabel}</Text>
          <Text style={[styles.classCardTime, { color: categoryColor }]}>{item.startTime}</Text>
          <Text style={styles.classCardDuration}>{item.duration}</Text>
        </View>
      </View>

      <View style={styles.classCardFooter}>
        <Text style={[styles.classCardPrice, { color: categoryColor }]}>EGP {item.price}</Text>
        <View style={styles.classCardBtns}>
          {item.status !== "full" && (
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/booking/flow", params: { classId: item.id, usePackage: "true" } });
              }}
              style={[styles.classPackageBtn, { borderColor: categoryColor + "60", backgroundColor: categoryColor + "12" }]}
            >
              <Ionicons name="add" size={16} color={categoryColor} />
              <Text style={[styles.classPackageBtnText, { color: categoryColor }]}>Package</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push({ pathname: "/booking/flow", params: { classId: item.id } });
            }}
            disabled={item.status === "full"}
            style={[
              styles.classBookBtn,
              item.status === "full"
                ? { backgroundColor: "#2A2A35" }
                : { backgroundColor: "transparent", borderWidth: 1, borderColor: categoryColor },
            ]}
          >
            <Text style={[styles.classBookBtnText, { color: item.status === "full" ? "#6B7280" : categoryColor }]}>
              {item.status === "full" ? "Full" : "Book"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// AsyncStorage key shared with notifications.tsx for tracking read API notification IDs
const API_NOTIF_READ_KEY = "api_notif_read_ids";

export default function StudioHomeScreen() {
  const { user, unreadNotifications, bookings, newStudentBannerDismissed, dismissNewStudentBanner } = useAppContext();
  const showNewStudentBanner = bookings.length === 0 && !newStudentBannerDismissed;
  const insets = useSafeAreaInsets();

  // ── API unread notification count (for bell badge) ─────────────────────────
  // Refreshes whenever the Home tab comes into focus so the badge reflects any
  // per-student notifications created by admin status changes (Bug 2 fix).
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

  // ── Hero items (system-managed, from backend only) ─────────────────────────
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

  // Live instructors
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

  // Instructor lookup map keyed by string ID
  const instructorMap = React.useMemo(() => {
    const m = new Map<string, Instructor>();
    instructors.forEach((i) => m.set(i.id, i));
    return m;
  }, [instructors]);

  // Live upcoming classes — join schedules + classes for the current Egyptian week
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

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const nowH = String(today.getHours()).padStart(2, "0");
    const nowM = String(today.getMinutes()).padStart(2, "0");
    const currentTime24 = `${nowH}:${nowM}`;

    // Egyptian week: Saturday → Thursday
    const dayOfWeek = today.getDay();
    const daysSinceSat = (dayOfWeek + 1) % 7;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - daysSinceSat);
    weekStart.setHours(0, 0, 0, 0);

    const thursdayDate = new Date(weekStart);
    thursdayDate.setDate(weekStart.getDate() + 5);
    const thuStr = thursdayDate.toISOString().slice(0, 10);

    const classMap = new Map(apiClasses.map((c) => [c.id, c]));

    const result: DanceClass[] = [];
    for (const sched of apiSchedules) {
      const cls = classMap.get(sched.classId);
      if (!cls || !cls.isActive) continue;

      const mapped = mapScheduleAndClassToMobile(sched, cls, weekStart);
      if (mapped.isBallet) continue;
      if (mapped.date < todayStr || mapped.date > thuStr) continue;

      if (mapped.date === todayStr && sched.startTime <= currentTime24) continue;

      const key = `${mapped.id}-${mapped.date}`;
      if (!result.some((r) => `${r.id}-${r.date}` === key)) {
        result.push(mapped);
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

    return result.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return parseDisplayTime(a.startTime) - parseDisplayTime(b.startTime);
    });
  }, [apiSchedules, apiClasses]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 40 : insets.top + 40 }]}>
        <View>
          <Text style={styles.headerLabel}>CENTRAL</Text>
          <Text style={styles.headerTitle}>Studio</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => router.push("/auth/login")} style={styles.headerBtn}>
            <Ionicons name="person-outline" size={22} color="#9CA3AF" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/notifications")}
            style={styles.headerBtn}
          >
            <Ionicons name="notifications-outline" size={22} color="#9CA3AF" />
            {(unreadNotifications + apiUnreadCount) > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {(unreadNotifications + apiUnreadCount) > 9 ? "9+" : (unreadNotifications + apiUnreadCount)}
                </Text>
              </View>
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

        <HeroCarousel
          items={heroItems}
          isLoading={isLoadingHero}
          isError={isErrorHero}
          error={heroError}
          onRetry={refetchHero}
        />

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Our Instructors</Text>
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

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionSubLabel, { color: colors.studio.primary }]}>THIS WEEK</Text>
              <Text style={styles.sectionTitle}>Upcoming Classes</Text>
            </View>
            <TouchableOpacity onPress={() => router.push("/(tabs)/classes")}>
              <Text style={[styles.seeAll, { color: colors.studio.primary }]}>See All</Text>
            </TouchableOpacity>
          </View>

          {isLoadingWeekClasses ? (
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              {[1, 2, 3].map((i) => <ClassListCardSkeleton key={i} />)}
            </View>
          ) : isErrorWeekClasses ? (
            isOfflineError(weekClassesError) ? (
              <OfflineState variant="compact" onRetry={() => { refetchSchedules(); refetchClasses(); }} />
            ) : (
              <ErrorState variant="compact" onRetry={() => { refetchSchedules(); refetchClasses(); }} message="Couldn't load upcoming classes." />
            )
          ) : weekClasses.length === 0 ? (
            <View style={[styles.emptyCard, { borderColor: colors.studio.border }]}>
              <Ionicons name="calendar-outline" size={32} color="#4B5563" />
              <Text style={styles.emptyTitle}>No upcoming classes this week</Text>
              <Text style={styles.emptyDesc}>Check back on Saturday for next week's schedule</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              {weekClasses.map((cls) => (
                <ClassListCard key={`${cls.id}-${cls.date}`} item={cls} instructorMap={instructorMap} />
              ))}
            </View>
          )}
        </View>

        <View style={[styles.packagesPromo, { borderColor: colors.studio.primary + "30", marginHorizontal: 20 }]}>
          <LinearGradient
            colors={["#003A47", "#001828"]}
            style={styles.packagesPromoInner}
          >
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 10,
    marginTop: 10,
    marginBottom: 10,
    marginLeft: 20,
    marginRight: 20,
    backgroundColor: colors.studio.background,
  },
  headerLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.studio.primary, letterSpacing: 3 },
  headerTitle: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFFFFF", lineHeight: 32 },
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E1E26",
    alignItems: "center", justifyContent: "center",
  },
  notifBadge: {
    position: "absolute", top: -2, right: -2,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.error,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 2,
  },
  notifBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#FFF" },
  scroll: { paddingTop: 40 },

  heroBanner: { marginHorizontal: HERO_MARGIN, borderRadius: 20, overflow: "hidden", marginBottom: 28, height: HERO_HEIGHT },
  heroSlide: { width: HERO_WIDTH, height: HERO_HEIGHT },
  heroDots: {
    position: "absolute", bottom: 10, left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5,
  },
  heroDot: { height: 6, borderRadius: 3 },
  heroBannerGradient: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 15, paddingBottom: 15,
    marginTop: 1, marginBottom: 1,
    gap: 6,
  },
  heroBannerTagline: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.studio.primary, letterSpacing: 2, textTransform: "uppercase" },
  heroBannerTitle: { fontSize: 30, fontFamily: "Inter_700Bold", color: "#FFFFFF", lineHeight: 36 },
  heroBannerBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 50, marginTop: 6,
    backgroundColor: "#FFFFFF",
  },
  heroBannerBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#000" },

  // Hero skeleton
  heroSkeletonBg: { backgroundColor: "#14141C", justifyContent: "flex-end" },
  heroSkeletonContent: { padding: 20, gap: 10 },
  heroSkeletonTagline: { width: 130, height: 10, borderRadius: 5, backgroundColor: "#2A2A35" },
  heroSkeletonTitle: { width: "75%", height: 28, borderRadius: 8, backgroundColor: "#2A2A35" },
  heroSkeletonBtn: { width: 110, height: 36, borderRadius: 50, backgroundColor: "#2A2A35", marginTop: 4 },

  // Hero error/offline state container
  heroStateBg: { backgroundColor: "#0E1619", justifyContent: "center", alignItems: "center" },

  section: { marginBottom: 28 },
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "flex-end", paddingHorizontal: 20, marginBottom: 14,
  },
  sectionSubLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 2, marginBottom: 2 },
  sectionTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium" },

  instructorCard: {
    width: 108, height: 176,
    borderRadius: 16, overflow: "hidden",
    backgroundColor: "#1E1E26",
  },
  instructorInitialsBg: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: "center", justifyContent: "center",
    alignSelf: "center", marginTop: 38,
  },
  instructorInitials: { fontSize: 20, fontFamily: "Inter_700Bold" },
  instructorOverlay: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    padding: 10, paddingBottom: 12,
  },
  instructorInfoRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  instructorName: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  instructorRole: { fontSize: 9, fontFamily: "Inter_500Medium", marginTop: 2 },
  instructorPlusBtn: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 1, backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },

  classCard: {
    borderRadius: 16, overflow: "hidden",
    backgroundColor: "#0E1619",
    borderWidth: 1, borderColor: "#1E2E38",
  },
  classCardTopBar: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", paddingHorizontal: 14, paddingVertical: 8,
  },
  categoryPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  categoryPillText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#000" },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  statusDotSmall: { width: 5, height: 5, borderRadius: 2.5 },
  statusPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  classCardBody: {
    flexDirection: "row", paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, gap: 10,
  },
  classCardLeft: { flex: 1, gap: 6 },
  classCardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF", lineHeight: 20 },
  classCardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", lineHeight: 16 },
  classCardInstructor: { flexDirection: "row", alignItems: "center", gap: 6 },
  instructorMiniAvatar: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  instructorMiniInitials: { fontSize: 10, fontFamily: "Inter_700Bold" },
  classCardInstructorLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  classCardInstructorName: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },

  classCardRight: { alignItems: "flex-end", justifyContent: "center", gap: 2, minWidth: 90 },
  classCardDayLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  classCardTime: { fontSize: 18, fontFamily: "Inter_700Bold" },
  classCardDuration: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280" },

  classCardFooter: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingBottom: 12, paddingTop: 4,
  },
  classCardPrice: { fontSize: 16, fontFamily: "Inter_700Bold" },
  classCardBtns: { flexDirection: "row", alignItems: "center", gap: 8 },
  classPackageBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1,
  },
  classPackageBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  classBookBtn: {
    paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 10,
  },
  classBookBtnText: { fontSize: 12, fontFamily: "Inter_700Bold" },

  emptyCard: {
    marginHorizontal: 20, borderRadius: 18, borderWidth: 1, borderStyle: "dashed",
    padding: 28, alignItems: "center", gap: 10,
    backgroundColor: colors.studio.card,
  },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", textAlign: "center" },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 18 },

  packagesPromo: {
    borderRadius: 16, borderWidth: 1, overflow: "hidden", marginBottom: 8,
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
});
