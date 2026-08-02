import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  getListSchedulesQueryKey,
  isYouTubeUrl,
  useGetClass,
  useGetInstructor,
  useListSchedules,
} from "@workspace/api-client-react";

import XI from "@/components/XiIcon";
import { iosDisplayTextStyle } from "@/utils/iosTypography";
import {
  classCapacityDisplay,
  compareSchedulesByNextOccurrence,
  isClassCapacityDisplayEnabled,
  isMobileVisibleSchedule,
  mapApiClassWithScheduleToMobile,
  mapApiInstructorToMobile,
} from "@/data/apiAdapters";
import { DetailSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";
import { DEFAULT_SINGLE_CLASS_PRICE_EGP, fetchClassPricing } from "@/services/classPricingService";
import { DEFAULT_CLASS_CAPACITY_ENABLED, fetchClassCapacitySettings } from "@/services/classCapacityService";
import { useAppContext } from "@/contexts/AppContext";
import { showAuthRequiredPrompt } from "@/utils/authRequired";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import type { AgeGroup, DanceClass, Instructor } from "@/data/mockData";

const INK_900 = "#0A0B0D";
const INK_800 = "#15171B";
const INK_700 = "#22262C";
const INK_400 = "#6B747F";
const INK_300 = "#8E97A2";
const INK_200 = "#B6BDC6";
const CYAN = "#00B6D7";
const MAGENTA = "#FF2E7E";
const AMBER = "#FFB02E";
const SUCCESS = "#1FB871";
const DANGER = "#FF3B47";
const R_MD = 12;
const R_LG = 16;
const R_PILL = 999;

function ClassVideoHero({ url }: { url: string }) {
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls
      allowsFullscreen
    />
  );
}

function statusLabel(st: DanceClass["status"]) {
  return st === "available" ? "Available"
       : st === "fewSeats" ? "Few Seats"
       : st === "full" ? "Full"
       : st === "cancelled" ? "Cancelled"
       : st === "unavailable" ? "Unavailable"
       : "Waitlist";
}

function statusColor(st: DanceClass["status"]) {
  return st === "available" ? SUCCESS
       : st === "fewSeats" ? AMBER
       : st === "full" ? DANGER
       : st === "cancelled" ? DANGER
       : st === "unavailable" ? INK_400
       : INK_300;
}

function statusBg(st: DanceClass["status"]) {
  return st === "available" ? "rgba(31,184,113,0.16)"
       : st === "fewSeats" ? "rgba(255,176,46,0.16)"
       : st === "full" ? "rgba(255,59,71,0.10)"
       : st === "cancelled" ? "rgba(255,59,71,0.10)"
       : st === "unavailable" ? "rgba(255,255,255,0.06)"
       : "rgba(255,255,255,0.06)";
}

function deriveDifficulty(ageGroup: AgeGroup) {
  return ageGroup === "Kids" ? "Beginner" : ageGroup === "Teens" ? "Intermediate" : "Advanced";
}

function diffColor(difficulty: string) {
  return difficulty === "Beginner" ? CYAN : difficulty === "Intermediate" ? AMBER : MAGENTA;
}

function styleLabel(title?: string) {
  return (title ?? "").replace(/\s*Instructor\s*$/i, "").trim() || "Instructor";
}

function XStars({ rating }: { rating: number }) {
  return (
    <View style={styles.stars}>
      {Array.from({ length: 5 }).map((_, i) => (
        <XI
          key={i}
          name="star"
          size={11}
          color={i < Math.round(rating) ? "#FFB81C" : "rgba(255,255,255,0.18)"}
        />
      ))}
      <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
    </View>
  );
}

export default function ClassDetailScreen() {
  const { id, scheduleId } = useLocalSearchParams<{ id: string; scheduleId?: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user, bookings, cancelBooking, userPackages } = useAppContext();
  const alert = useCentralAlert();
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [instructorImageFailed, setInstructorImageFailed] = useState(false);

  const numericId = Number(id);
  const classQuery = useGetClass(numericId, {
    query: { queryKey: ["class", numericId], enabled: !!id && !isNaN(numericId) },
  });
  const schedulesQuery = useListSchedules(
    { classId: numericId },
    { query: { queryKey: ["class-schedules", numericId], enabled: !!id && !isNaN(numericId) } },
  );
  const classPricingQuery = useQuery({
    queryKey: ["class-pricing"],
    queryFn: fetchClassPricing,
    staleTime: 5 * 60 * 1000,
  });
  const classCapacityQuery = useQuery({
    queryKey: ["class-capacity"],
    queryFn: fetchClassCapacitySettings,
    staleTime: 60 * 1000,
  });
  const singleClassPriceEgp =
    classPricingQuery.data?.singleClassPriceEgp ?? DEFAULT_SINGLE_CLASS_PRICE_EGP;
  const classCapacityEnabled =
    classCapacityQuery.data?.classCapacityEnabled ?? DEFAULT_CLASS_CAPACITY_ENABLED;

  const primarySchedule = schedulesQuery.data
    ? schedulesQuery.data.filter(isMobileVisibleSchedule).find((schedule) => String(schedule.id) === scheduleId) ??
      [...schedulesQuery.data].filter(isMobileVisibleSchedule).sort((a, b) => compareSchedulesByNextOccurrence(a, b))[0]
    : undefined;
  const cls = classQuery.data
    ? mapApiClassWithScheduleToMobile(classQuery.data, primarySchedule, singleClassPriceEgp, classCapacityEnabled)
    : null;

  const instructorQuery = useGetInstructor(classQuery.data?.instructorId ?? 0, {
    query: { queryKey: ["instructor", classQuery.data?.instructorId ?? 0], enabled: !!classQuery.data?.instructorId },
  });
  const instructor: Instructor | null = instructorQuery.data
    ? mapApiInstructorToMobile(instructorQuery.data)
    : null;

  const packageCreditsRemaining = useMemo(
    () => userPackages
      .filter((pkg) => pkg.status === "active" && pkg.remainingCredits > 0)
      .reduce((sum, pkg) => sum + pkg.remainingCredits, 0),
    [userPackages],
  );

  const activeBooking = useMemo(() => {
    if (!cls) return undefined;
    return bookings.find((booking) =>
      booking.classId === cls.id &&
      (cls.scheduleId ? booking.scheduleId === cls.scheduleId : true) &&
      booking.occurrenceDate === cls.date &&
      (booking.bookingStatus === "pending" || booking.bookingStatus === "confirmed"),
    );
  }, [bookings, cls]);

  const handleCancel = useCallback(() => {
    if (!activeBooking || !cls) return;
    alert.show({
      tone: "destructive",
      title: "Cancel booking?",
      message: `Cancel your booking for ${cls.title}? This frees up your seat.`,
      actions: [
        { label: "Keep booking", tone: "neutral" },
        {
          label: "Cancel booking",
          tone: "danger",
          onPress: async () => {
            try {
              await cancelBooking(activeBooking.id);
              await queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() });
              await schedulesQuery.refetch();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              alert.show({ tone: "error", title: "Couldn't cancel", message: error instanceof Error ? error.message : "Please try again." });
            }
          },
        },
      ],
    });
  }, [activeBooking, cancelBooking, cls, queryClient, schedulesQuery, alert]);

  if (classQuery.isLoading || schedulesQuery.isLoading) {
    return <DetailSkeleton />;
  }

  if ((classQuery.isError && isOfflineError(classQuery.error)) || (schedulesQuery.isError && isOfflineError(schedulesQuery.error))) {
    return (
      <View style={[styles.container, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnAbsolute}>
          <XI name="back" size={22} stroke={2.2} color="#FFFFFF" />
        </TouchableOpacity>
        <OfflineState onRetry={() => { classQuery.refetch(); schedulesQuery.refetch(); }} />
      </View>
    );
  }

  if (classQuery.isError || schedulesQuery.isError || !cls) {
    return (
      <View style={[styles.container, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnAbsolute}>
          <XI name="back" size={22} stroke={2.2} color="#FFFFFF" />
        </TouchableOpacity>
        {classQuery.isError || schedulesQuery.isError ? (
          <ErrorState onRetry={() => { classQuery.refetch(); schedulesQuery.refetch(); }} message="Couldn't load class details." />
        ) : (
          <ErrorState title="Class not found" message="This class may no longer be available." onRetry={() => router.back()} />
        )}
      </View>
    );
  }

  const st = cls.status;
  const stC = statusColor(st);
  const stBg = statusBg(st);
  const difficulty = deriveDifficulty(cls.ageGroup);
  const cap = classCapacityDisplay(cls);
  const showCapacity = isClassCapacityDisplayEnabled(cls);
  const availableSeats = cap.available;
  const creditsLeft = cls.packageEligible ? packageCreditsRemaining : 0;
  const rating = (cls as unknown as { rating?: number }).rating;
  const reviewCount = (cls as unknown as { reviewCount?: number }).reviewCount;
  const hasSchedule = Boolean(cls.scheduleId && cls.dayOfWeek && cls.startTime);
  const youtubeVideo = isYouTubeUrl(cls.classVideoUrl);
  const playableVideoUrl = cls.classVideoUrl && !youtubeVideo ? cls.classVideoUrl : undefined;
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = (Platform.OS === "web" ? 24 : insets.bottom) + 18;

  function openBooking(usePackage: boolean) {
    const currentClass = cls;
    if (!currentClass || st === "full" || st === "cancelled" || st === "unavailable" || !hasSchedule) return;
    if (!user) {
      showAuthRequiredPrompt();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: "/booking/flow",
      params: {
        classId: currentClass.id,
        scheduleId: currentClass.scheduleId,
        ...(usePackage ? { usePackage: "true" } : {}),
      },
    });
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
        <View style={styles.hero}>
          {playableVideoUrl ? (
            <ClassVideoHero url={playableVideoUrl} />
          ) : cls.photoUrl && !heroImageFailed ? (
            <Image
              source={{ uri: cls.photoUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={() => setHeroImageFailed(true)}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: INK_700 }]} />
          )}
          <LinearGradient
            colors={["rgba(5,6,8,0.48)", "rgba(5,6,8,0.10)", "rgba(5,6,8,0.80)"]}
            locations={[0, 0.38, 1]}
            style={StyleSheet.absoluteFill}
          />
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { top: topPad + 14 }]}
            activeOpacity={0.85}
          >
            <XI name="back" size={22} stroke={2.2} color="#fff" />
          </TouchableOpacity>
          {youtubeVideo && cls.classVideoUrl && (
            <TouchableOpacity
              onPress={() => Linking.openURL(cls.classVideoUrl!)}
              style={[styles.videoBtn, { top: topPad + 14 }]}
              activeOpacity={0.86}
            >
              <Ionicons name="logo-youtube" size={16} color="#FFFFFF" />
              <Text style={styles.videoBtnText}>Watch</Text>
            </TouchableOpacity>
          )}
          <View style={styles.heroBottom}>
            <View style={styles.heroChips}>
              <View style={styles.chipDark}>
                <Text style={styles.chipDarkText}>{cls.categoryName}</Text>
              </View>
              <View style={[styles.chipDark, { backgroundColor: stBg }]}>
                <Text style={[styles.chipDarkText, { color: stC }]}>{statusLabel(st)}</Text>
              </View>
            </View>
            <Text style={styles.title}>{cls.title.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.topRow}>
            {rating ? <XStars rating={rating} /> : null}
            <Text style={styles.reviews}>{reviewCount ? `(${reviewCount} reviews)` : ""}</Text>
            <View style={styles.diffChip}>
              <Text style={[styles.diffText, { color: diffColor(difficulty) }]}>{difficulty}</Text>
            </View>
          </View>

          {!!cls.description && <Text style={styles.desc}>{cls.description}</Text>}

          <View style={styles.section}>
            <Text style={styles.eyebrow}>Age eligibility</Text>
            <Text style={styles.desc}>{cls.ageRangeLabel ?? cls.ageGroup}</Text>
            {cls.catalogueEligibility?.evaluated && cls.catalogueEligibility.eligible === false ? (
              <Text style={[styles.desc, { color: DANGER }]}>
                {cls.catalogueEligibility.reasons[0]?.message ?? "This class is not eligible for your profile."}
              </Text>
            ) : null}
          </View>

          <View style={styles.divider} />

          <View style={styles.section}>
            <Text style={styles.eyebrow}>Schedule</Text>
            <View style={styles.scheduleGrid}>
              {[
                { label: "Day", val: cls.dayOfWeek ?? "-" },
                { label: "Time", val: cls.startTime ?? "-" },
                { label: "Duration", val: cls.duration ?? "-" },
              ].map((row) => (
                <View key={row.label} style={styles.scheduleTile}>
                  <Text style={styles.scheduleTileLabel}>{row.label}</Text>
                  <Text style={styles.scheduleTileVal}>{row.val}</Text>
                </View>
              ))}
            </View>
            {!!cls.location && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
                <Ionicons name="location-outline" size={15} color={CYAN} />
                <Text style={[styles.desc, { color: "#FFFFFF", fontFamily: "Archivo_600SemiBold", marginTop: 0 }]}>
                  {cls.location}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.eyebrow}>Instructor</Text>
            <View style={styles.instructorCard}>
              {instructor?.photoUrl && !instructorImageFailed ? (
                <Image
                  source={{ uri: instructor.photoUrl }}
                  style={styles.instructorAvatar}
                  resizeMode="cover"
                  onError={() => setInstructorImageFailed(true)}
                />
              ) : (
                <View style={[styles.instructorAvatar, styles.instructorFallback]}>
                  <Text style={styles.instructorInitial}>{(instructor?.name ?? "?")[0]}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.instructorName}>{instructor?.name ?? "Instructor"}</Text>
                <Text style={styles.instructorSpec}>{styleLabel(instructor?.title)}</Text>
              </View>
            </View>
          </View>

          {showCapacity && (
          <View style={styles.section}>
            <Text style={styles.eyebrow}>Capacity</Text>
            <View style={styles.capCard}>
              <View style={styles.capRow}>
                <Text style={styles.capText}>
                  <Text style={styles.capStrong}>{cls.capacity}</Text>{" total"}
                </Text>
                <Text style={styles.capText}>
                  <Text style={[styles.capStrong, { color: SUCCESS }]}>{availableSeats}</Text>{" available"}
                </Text>
                <Text style={styles.capText}>
                  <Text style={[styles.capStrong, { color: INK_200 }]}>{cap.booked}</Text>{" booked"}
                </Text>
              </View>
              <View style={styles.capBarBg}>
                <View style={[styles.capBarFill, { width: `${cap.pct}%` as any, backgroundColor: cap.pct > 80 ? DANGER : CYAN }]} />
              </View>
            </View>
          </View>
          )}
        </View>

        <View style={{ height: 160 }} />
      </ScrollView>

      <LinearGradient
        colors={["rgba(6,12,16,0)", INK_900]}
        locations={[0, 0.28]}
        style={[styles.footer, { paddingBottom: bottomPad }]}
      >
        <View style={styles.footerTop}>
          <View>
            <Text style={styles.footerPrice}>EGP {cls.price}</Text>
            {creditsLeft > 0 && (
              <Text style={styles.footerCredits}>or {creditsLeft} credits from your package</Text>
            )}
          </View>
          <View style={[styles.footerStatusBadge, { backgroundColor: stBg }]}>
            <Text style={[styles.footerStatusText, { color: stC }]}>{statusLabel(st)}</Text>
          </View>
        </View>

        {activeBooking ? (
          <TouchableOpacity onPress={handleCancel} style={styles.btnCancel} activeOpacity={0.85}>
            <Text style={styles.btnCancelText}>Cancel Booking</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.actionRow}>
            {creditsLeft > 0 && st !== "full" && st !== "cancelled" && st !== "unavailable" && (
              <TouchableOpacity
                onPress={() => openBooking(true)}
                style={styles.btnPackage}
                activeOpacity={0.85}
              >
                <Text style={styles.btnPackageText}>Use Package</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => openBooking(false)}
              style={[
                styles.btnBook,
                (st === "full" || st === "cancelled" || !hasSchedule) && styles.btnDisabled,
                (st === "unavailable") && styles.btnDisabled,
              ]}
              activeOpacity={0.85}
            >
              <Text style={[
                styles.btnBookText,
                (st === "full" || st === "cancelled" || !hasSchedule) && styles.btnDisabledText,
                (st === "unavailable") && styles.btnDisabledText,
              ]}>
                {st === "cancelled" ? "Cancelled" : st === "unavailable" ? "Unavailable" : st === "full" ? "Full" : hasSchedule ? "Book Now" : "Schedule Not Set"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK_900 },
  backBtnAbsolute: {
    position: "absolute", top: 60, left: 20, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: INK_800, alignItems: "center", justifyContent: "center",
  },
  hero: { height: 224, position: "relative" },
  backBtn: {
    position: "absolute", left: 18, width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.52)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center", zIndex: 10,
  },
  videoBtn: {
    position: "absolute", right: 18, height: 40, borderRadius: 20,
    paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,0,0,0.82)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", zIndex: 10,
  },
  videoBtnText: { color: "#FFFFFF", fontSize: 12, fontFamily: "Archivo_700Bold" },
  heroBottom: { position: "absolute", bottom: 14, left: 18, right: 18 },
  heroChips: { flexDirection: "row", gap: 7, marginBottom: 8 },
  chipDark: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: R_PILL, backgroundColor: "rgba(0,0,0,0.52)" },
  chipDarkText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", color: "#fff", textTransform: "uppercase", letterSpacing: 0.8 },
  title: { fontSize: 42, fontFamily: "Anton_400Regular", color: "#fff", lineHeight: 38, ...iosDisplayTextStyle(42, 38), textTransform: "uppercase" },
  body: { padding: 20, paddingBottom: 0 },
  topRow: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16,
    paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)",
  },
  stars: { flexDirection: "row", alignItems: "center", gap: 2 },
  ratingText: { fontSize: 11, fontFamily: "Archivo_400Regular", color: INK_300, marginLeft: 3 },
  reviews: { fontSize: 13, fontFamily: "Archivo_400Regular", color: INK_400 },
  diffChip: { marginLeft: "auto", paddingHorizontal: 10, paddingVertical: 4, borderRadius: R_PILL, backgroundColor: "rgba(255,255,255,0.06)" },
  diffText: { fontSize: 12, fontFamily: "Archivo_700Bold" },
  desc: { fontSize: 15, fontFamily: "Archivo_400Regular", color: INK_200, lineHeight: 24, marginBottom: 20 },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.07)", marginBottom: 20 },
  section: { marginBottom: 20 },
  eyebrow: {
    fontSize: 10, fontFamily: "SpaceMono_700Bold", letterSpacing: 1.8,
    textTransform: "uppercase", color: CYAN, marginBottom: 12,
  },
  scheduleGrid: { flexDirection: "row", gap: 9 },
  scheduleTile: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 10,
    backgroundColor: INK_800, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)",
    borderRadius: R_MD, alignItems: "center",
  },
  scheduleTileLabel: {
    fontSize: 11, fontFamily: "Archivo_600SemiBold", color: INK_400,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5,
  },
  scheduleTileVal: { fontSize: 13, fontFamily: "Archivo_700Bold", color: "#fff", lineHeight: 16, textAlign: "center" },
  instructorCard: {
    flexDirection: "row", alignItems: "center", gap: 14, padding: 14,
    backgroundColor: INK_800, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", borderRadius: R_LG,
  },
  instructorAvatar: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: INK_700,
    flexShrink: 0, borderWidth: 2, borderColor: CYAN,
  },
  instructorFallback: { alignItems: "center", justifyContent: "center", backgroundColor: CYAN + "22" },
  instructorInitial: { fontSize: 15, fontFamily: "Archivo_700Bold", color: CYAN },
  instructorName: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#fff" },
  instructorSpec: { fontSize: 13, fontFamily: "Archivo_400Regular", color: CYAN, marginTop: 2 },
  capCard: {
    padding: 14, backgroundColor: INK_800,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", borderRadius: R_LG,
  },
  capRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  capText: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: INK_300 },
  capStrong: { color: "#fff", fontFamily: "Archivo_800ExtraBold" },
  capBarBg: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.07)", overflow: "hidden" },
  capBarFill: { height: "100%", borderRadius: 4 },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 14 },
  footerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  footerPrice: { fontSize: 28, fontFamily: "Anton_400Regular", color: "#fff", lineHeight: 25, ...iosDisplayTextStyle(28, 25) },
  footerCredits: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: CYAN, marginTop: 4 },
  footerStatusBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: R_PILL },
  footerStatusText: { fontSize: 12, fontFamily: "Archivo_700Bold" },
  actionRow: { flexDirection: "row", gap: 10 },
  btnPackage: {
    flex: 1, paddingVertical: 14, borderRadius: R_MD,
    borderWidth: 1.5, borderColor: "rgba(0,182,215,0.46)",
    backgroundColor: "rgba(0,182,215,0.10)", alignItems: "center",
  },
  btnPackageText: { fontSize: 14, fontFamily: "Archivo_700Bold", color: CYAN },
  btnBook: { flex: 1, paddingVertical: 14, borderRadius: R_MD, backgroundColor: CYAN, alignItems: "center" },
  btnBookText: { fontSize: 14, fontFamily: "Archivo_800ExtraBold", color: INK_900 },
  btnDisabled: { backgroundColor: "rgba(255,255,255,0.06)" },
  btnDisabledText: { color: INK_400 },
  btnCancel: {
    paddingVertical: 14, borderRadius: R_MD,
    borderWidth: 1.5, borderColor: "rgba(255,59,71,0.5)",
    backgroundColor: "rgba(255,59,71,0.10)", alignItems: "center",
  },
  btnCancelText: { fontSize: 14, fontFamily: "Archivo_800ExtraBold", color: DANGER },
});
