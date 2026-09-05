import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getListSchedulesQueryKey,
  isYouTubeUrl,
  normalizeMediaUrl,
  useGetClass,
  useGetInstructor,
  useListDanceTypes,
  useListSchedules,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { GlassView } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { pushOnce } from "@/utils/navigation";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useMemo, useState } from "react";
import {
  Image,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BookingCalendarIcon,
  BookingLocationIcon,
  BookingWatchIcon,
} from "@/components/BookingDetailsIcons";
import CategoryIcon from "@/components/CategoryIcon";
import CentralBackButton from "@/components/CentralBackButton";
import ErrorState from "@/components/ErrorState";
import OfflineState from "@/components/OfflineState";
import SBI from "@/components/SbIcon";
import { DetailSkeleton } from "@/components/SkeletonLoader";
import { useAppContext, type Booking } from "@/contexts/AppContext";
import {
  compareSchedulesByNextOccurrence,
  isMobileVisibleSchedule,
  mapApiClassWithScheduleToMobile,
  mapApiInstructorToMobile,
} from "@/data/apiAdapters";
import type { DanceClass, Instructor } from "@/data/mockData";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import { DEFAULT_CLASS_CAPACITY_ENABLED, fetchClassCapacitySettings } from "@/services/classCapacityService";
import { fetchClassPricing } from "@/services/classPricingService";
import { isOfflineError } from "@/services/connectivity";
import { showAuthRequiredPrompt } from "@/utils/authRequired";

const INK = "#050607";
const CARD = "#012329";
const CYAN = "#03B6D7";
const MUTED = "#B6BDC6";
const GREEN = "#24C65A";
const AMBER = "#FFC400";
const RED = "#FF101B";

type ParticipantCandidate = {
  participantType: "self" | "child";
  participantChildId: number | null;
  participantName: string;
  eligible: boolean;
  reasonCode: string;
  existingBookingState: string | null;
};

function statusState(status: DanceClass["status"]) {
  switch (status) {
    case "available": return { label: "Available", color: GREEN, background: "rgba(36,198,90,0.22)" };
    case "fewSeats": return { label: "Few Seats", color: AMBER, background: "rgba(255,196,0,0.20)" };
    case "full": return { label: "Full", color: RED, background: "rgba(255,16,27,0.20)" };
    case "cancelled": return { label: "Cancelled", color: RED, background: "rgba(255,16,27,0.20)" };
    case "unavailable": return { label: "Unavailable", color: MUTED, background: "rgba(255,255,255,0.10)" };
    default: return { label: "Waitlist", color: AMBER, background: "rgba(255,196,0,0.20)" };
  }
}

function dateDisplay(raw?: string, fallbackDay?: string) {
  const match = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { day: fallbackDay || "Date", date: "TBD" };
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return {
    day: fallbackDay || date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
    date: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }),
  };
}

function clock(raw?: string | null) {
  const match = raw?.match(/(\d{1,2}):(\d{2})/);
  return match ? `${String(Number(match[1])).padStart(2, "0")}:${match[2]}` : "";
}

function normalizedName(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function levelColor(level: string) {
  if (/beginner/i.test(level)) return "#D800D8";
  if (/intermediate/i.test(level)) return AMBER;
  if (/advanced/i.test(level)) return RED;
  return "#7C3AED";
}

function ageColor(age: string) {
  if (/kid/i.test(age)) return "#075CE5";
  if (/teen/i.test(age)) return "#7C3AED";
  if (/adult/i.test(age)) return "#FF6B2C";
  return CYAN;
}

function PersonAvatar({ image, name, size = 38 }: { image?: string; name: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {image ? (
        <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <Text style={styles.avatarInitial}>{name.trim().charAt(0).toUpperCase() || "?"}</Text>
      )}
    </View>
  );
}

function DirectTrailer({ url }: { url: string }) {
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = false;
    instance.muted = false;
  });

  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls allowsFullscreen />;
}

function youtubeThumbnail(url: string) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/i);
  return match?.[1] ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : null;
}

function ClassTrailer({ url, title }: { url?: string; title: string }) {
  if (!url) {
    return (
      <View style={styles.trailerCard}>
        <Text style={styles.trailerUnavailable}>NOT AVAILABLE</Text>
      </View>
    );
  }

  if (!isYouTubeUrl(url)) {
    return <View style={styles.trailerCard}><DirectTrailer url={url} /></View>;
  }

  const thumbnail = youtubeThumbnail(url);

  return (
    <TouchableOpacity
      style={styles.trailerCard}
      activeOpacity={0.88}
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="button"
      accessibilityLabel={`Watch ${title} class trailer`}
    >
      {thumbnail ? (
        <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <LinearGradient colors={["#283038", "#090B0D"]} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient colors={["rgba(0,0,0,0.05)", "rgba(0,0,0,0.34)"]} style={StyleSheet.absoluteFill} />
      <View style={styles.youtubeButton}><Ionicons name="play" size={32} color="#FFFFFF" /></View>
    </TouchableOpacity>
  );
}

export default function ClassDetailScreen() {
  const { id, scheduleId } = useLocalSearchParams<{ id: string; scheduleId?: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user, bookings, cancelBooking } = useAppContext();
  const alert = useCentralAlert();
  const [heroFailed, setHeroFailed] = useState(false);

  const numericId = Number(id);
  const classQuery = useGetClass(numericId, {
    query: { queryKey: ["class", numericId], enabled: Boolean(id) && Number.isInteger(numericId) },
  });
  const schedulesQuery = useListSchedules(
    { classId: numericId },
    { query: { queryKey: ["class-schedules", numericId], enabled: Boolean(id) && Number.isInteger(numericId) } },
  );
  const pricingQuery = useQuery({ queryKey: ["class-pricing"], queryFn: fetchClassPricing, staleTime: 5 * 60 * 1000 });
  const capacityQuery = useQuery({ queryKey: ["class-capacity"], queryFn: fetchClassCapacitySettings, staleTime: 60 * 1000 });

  const primarySchedule = schedulesQuery.data
    ? schedulesQuery.data.filter(isMobileVisibleSchedule).find((schedule) => String(schedule.id) === scheduleId)
      ?? [...schedulesQuery.data].filter(isMobileVisibleSchedule).sort(compareSchedulesByNextOccurrence)[0]
    : undefined;
  const cls = classQuery.data
    ? mapApiClassWithScheduleToMobile(
        classQuery.data,
        primarySchedule,
        pricingQuery.data,
        capacityQuery.data?.classCapacityEnabled ?? DEFAULT_CLASS_CAPACITY_ENABLED,
      )
    : null;

  const instructorQuery = useGetInstructor(classQuery.data?.instructorId ?? 0, {
    query: { queryKey: ["class-detail-instructor", classQuery.data?.instructorId ?? 0], enabled: Boolean(classQuery.data?.instructorId) },
  });
  const instructor: Instructor | null = instructorQuery.data ? mapApiInstructorToMobile(instructorQuery.data) : null;
  const danceTypesQuery = useListDanceTypes();

  const participantCandidatesQuery = useQuery({
    queryKey: ["booking-participant-candidates", cls?.scheduleId, cls?.date],
    queryFn: () => customFetch<{ candidates: ParticipantCandidate[] }>(
      `/api/bookings/participant-candidates?scheduleId=${encodeURIComponent(String(cls!.scheduleId))}&occurrenceDate=${encodeURIComponent(cls!.date)}`,
    ),
    enabled: Boolean(user && cls?.scheduleId && cls?.date),
    staleTime: 0,
  });

  const occurrenceBookings = useMemo(() => {
    if (!cls) return [];
    return bookings.filter((booking) =>
      String(booking.classId) === String(cls.id)
      && String(booking.scheduleId ?? "") === String(cls.scheduleId ?? "")
      && (booking.occurrenceDate ?? booking.date) === cls.date
      && (booking.bookingStatus === "pending" || booking.bookingStatus === "confirmed"),
    );
  }, [bookings, cls]);

  const cancelTarget: Booking | undefined = useMemo(
    () => occurrenceBookings.find((booking) => booking.participantType === "self") ?? occurrenceBookings[0],
    [occurrenceBookings],
  );
  const hasAnotherBookableParticipant = Boolean(participantCandidatesQuery.data?.candidates.some((candidate) => candidate.eligible));
  const shouldCancel = Boolean(cancelTarget && participantCandidatesQuery.data && !hasAnotherBookableParticipant);

  const handleCancel = useCallback(() => {
    if (!cancelTarget || !cls) return;
    alert.show({
      tone: "destructive",
      title: "Cancel booking?",
      message: `Cancel ${cancelTarget.participantName}'s booking for ${cls.title}?`,
      actions: [
        { label: "Keep booking", tone: "neutral" },
        {
          label: "Cancel booking",
          tone: "danger",
          onPress: async () => {
            try {
              await cancelBooking(cancelTarget.id);
              await queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() });
              await participantCandidatesQuery.refetch();
              await schedulesQuery.refetch();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              alert.show({ tone: "error", title: "Couldn't cancel", message: error instanceof Error ? error.message : "Please try again." });
            }
          },
        },
      ],
    });
  }, [alert, cancelBooking, cancelTarget, cls, participantCandidatesQuery, queryClient, schedulesQuery]);

  if (classQuery.isLoading || schedulesQuery.isLoading) return <DetailSkeleton />;

  if ((classQuery.isError && isOfflineError(classQuery.error)) || (schedulesQuery.isError && isOfflineError(schedulesQuery.error))) {
    return (
      <View style={[styles.screen, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <CentralBackButton style={styles.stateBack} />
        <OfflineState onRetry={() => { classQuery.refetch(); schedulesQuery.refetch(); }} />
      </View>
    );
  }

  if (classQuery.isError || schedulesQuery.isError || !cls) {
    return (
      <View style={[styles.screen, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <CentralBackButton style={styles.stateBack} />
        <ErrorState
          title={!cls ? "Class not found" : undefined}
          message={!cls ? "This class may no longer be available." : "Couldn't load class details."}
          onRetry={() => { classQuery.refetch(); schedulesQuery.refetch(); }}
        />
      </View>
    );
  }

  const status = statusState(cls.status);
  const displayDate = dateDisplay(cls.date, cls.dayOfWeek);
  const startTime = clock(cls.startTime) || "--:--";
  const endTime = clock(cls.endTime);
  const timeRange = endTime ? `${startTime} - ${endTime}` : startTime;
  const branchName = cls.location || "Central Studio";
  const durationLabel = cls.duration || "Duration TBC";
  const classType = cls.categoryName || "Class";
  const level = cls.level || "All Levels";
  const age = cls.ageRangeLabel || cls.ageGroup || "All Ages";
  const heroImage = normalizeMediaUrl(cls.photoUrl, "image");
  const trailerUrl = normalizeMediaUrl(cls.classVideoUrl, "video");
  const instructorImage = normalizeMediaUrl(instructor?.photoUrl, "image");
  const instructorName = instructor?.name || "Instructor";
  const instructorId = instructor?.id || cls.instructorId;
  const hasSchedule = Boolean(cls.scheduleId && cls.dayOfWeek && cls.startTime);
  const isBookable = hasSchedule && !["full", "cancelled", "unavailable"].includes(cls.status);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = (Platform.OS === "web" ? 20 : insets.bottom) + 12;

  const danceType = (() => {
    const types = danceTypesQuery.data ?? [];
    if (cls.danceTypeId != null) {
      const exact = types.find((item) => item.id === cls.danceTypeId);
      if (exact) return exact;
    }
    const target = normalizedName(classType);
    return types.find((item) => normalizedName(item.name) === target || normalizedName(item.slug) === target);
  })();

  function openBooking() {
    if (!cls || !isBookable) return;
    if (!user) {
      showAuthRequiredPrompt();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    pushOnce({ pathname: "/booking/flow", params: { classId: cls.id, scheduleId: cls.scheduleId } });
  }

  function openInstructor() {
    if (!instructorId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pushOnce({ pathname: "/instructor/[id]", params: { id: String(instructorId) } });
  }

  const ctaLabel = shouldCancel
    ? "Cancel Booking"
    : cls.status === "cancelled"
      ? "Class Cancelled"
      : cls.status === "full"
        ? "Class Full"
        : cls.status === "unavailable"
          ? "Unavailable"
          : hasSchedule
            ? "Book Class"
            : "Schedule Not Set";

  return (
    <View style={styles.screen}>
      <View style={styles.fixedContent}>
        <View style={styles.hero}>
          {heroImage && !heroFailed ? (
            <Image source={{ uri: heroImage }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setHeroFailed(true)} />
          ) : (
            <LinearGradient colors={["#283038", "#090B0D"]} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient colors={["rgba(0,0,0,0.18)", "rgba(0,0,0,0.00)", "rgba(5,6,7,0.62)"]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
          <CentralBackButton style={[styles.back, { top: topPad + 12 }]} />
        </View>

        <View style={styles.mainCard}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>{cls.title}</Text>
            <View style={[styles.statusPill, { backgroundColor: status.background, borderColor: status.color }]}>
              <View style={[styles.statusDot, { backgroundColor: status.color }]} />
              <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>
          <Text style={styles.description} numberOfLines={2}>{cls.description}</Text>

          <View style={styles.schedulePanel}>
            <GlassView glassEffectStyle="clear" tintColor="rgba(255,255,255,0.08)" colorScheme="dark" pointerEvents="none" style={StyleSheet.absoluteFill} />
            <View style={styles.scheduleContent}>
              <View style={styles.scheduleCell}>
                <BookingCalendarIcon />
                <Text style={styles.scheduleValue} numberOfLines={1}>{displayDate.day}</Text>
                <Text style={styles.scheduleLabel} numberOfLines={1}>{displayDate.date}</Text>
              </View>
              <View style={styles.separator} />
              <View style={styles.scheduleCell}>
                <BookingWatchIcon />
                <Text style={styles.scheduleValue} numberOfLines={1}>{timeRange}</Text>
                <Text style={styles.scheduleLabel}>{durationLabel}</Text>
              </View>
              <View style={styles.separator} />
              <View style={styles.scheduleCell}>
                <BookingLocationIcon />
                <Text style={styles.scheduleValue} numberOfLines={1}>{branchName}</Text>
                <Text style={styles.scheduleLabel}>Branch</Text>
              </View>
            </View>
          </View>

          <View style={styles.trailerSection}>
            <Text style={styles.trailerTitle}>Watch Class Trailer :</Text>
            <ClassTrailer url={trailerUrl} title={cls.title} />
          </View>
        </View>

        <View style={styles.instructorAndTags}>
          <TouchableOpacity style={styles.instructor} onPress={openInstructor} disabled={!instructorId} activeOpacity={0.82}>
            <PersonAvatar image={instructorImage} name={instructorName} size={38} />
            <View style={styles.instructorCopy}>
              <Text style={styles.instructorLabel}>Instructor</Text>
              <Text style={styles.instructorName} numberOfLines={1}>{instructorName}</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.tags}>
            <View style={[styles.tag, styles.styleTag]}>
              <CategoryIcon iconSvg={danceType?.iconSvg} iconUrl={danceType?.iconUrl} name={classType} color={danceType?.color || CYAN} size={13} />
              <Text style={[styles.tagText, styles.styleTagText]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{classType}</Text>
            </View>
            <View style={[styles.tag, { backgroundColor: levelColor(level) }]}><Text style={styles.tagText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{level}</Text></View>
            <View style={[styles.tag, { backgroundColor: ageColor(age) }]}><Text style={styles.tagText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{age}</Text></View>
          </View>
        </View>

      </View>

      <View style={[styles.actionCard, { paddingBottom: bottomPad }]}>
          <View style={styles.priceRow}>
            <Text style={styles.purchaseHint}>Book Class by paying the{`\n`}walk-in price or buy a{`\n`}package</Text>
            <View style={styles.priceColumn}>
              <Text style={styles.priceLabel}>Class Price:</Text>
              <Text style={styles.price}>{cls.price > 0 ? `${cls.price} EGP` : "TBC"}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, shouldCancel && styles.cancelButton, !shouldCancel && !isBookable && styles.disabledButton]}
            disabled={!shouldCancel && !isBookable}
            onPress={shouldCancel ? handleCancel : openBooking}
            activeOpacity={0.84}
          >
            {shouldCancel ? <SBI name="x" size={18} stroke={2} color="#FFFFFF" /> : null}
            <Text style={styles.primaryButtonText}>{ctaLabel}</Text>
          </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INK },
  fixedContent: { flex: 1, minHeight: 0 },
  stateBack: { position: "absolute", top: 60, left: 16, zIndex: 10 },
  hero: { height: 190, position: "relative", backgroundColor: "#17191D" },
  back: { position: "absolute", left: 16, zIndex: 10 },
  mainCard: { flex: 1, minHeight: 0, marginTop: -35, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderBottomLeftRadius: 25, borderBottomRightRadius: 25, backgroundColor: CARD, paddingHorizontal: 19, paddingTop: 24, paddingBottom: 20, zIndex: 3 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  title: { flex: 1, color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 34, lineHeight: 38, textTransform: "uppercase" },
  statusPill: { minHeight: 30, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 2 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontFamily: "Archivo_700Bold", fontSize: 11.5 },
  description: { marginTop: 4, color: "#D2D7DC", fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 20 },
  schedulePanel: { height: 78, borderRadius: 15, overflow: "hidden", marginTop: 14, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  scheduleContent: { flex: 1, flexDirection: "row", paddingHorizontal: 9, paddingVertical: 9 },
  scheduleCell: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 2 },
  separator: { width: 1, marginVertical: 3, backgroundColor: "rgba(255,255,255,0.28)" },
  scheduleValue: { width: "100%", textAlign: "center", color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 12, lineHeight: 15 },
  scheduleLabel: { width: "100%", textAlign: "center", color: "#AEB5BE", fontFamily: "Archivo_400Regular", fontSize: 9.5, lineHeight: 11 },
  trailerSection: { flex: 1, minHeight: 0, marginTop: 14 },
  trailerTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 14, lineHeight: 18, marginBottom: 7 },
  trailerCard: { flex: 1, minHeight: 70, width: "100%", borderRadius: 16, overflow: "hidden", backgroundColor: "#001A1E", alignItems: "center", justifyContent: "center" },
  trailerUnavailable: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 16, lineHeight: 20 },
  youtubeButton: { width: 57, height: 40, borderRadius: 10, backgroundColor: "#FF101B", alignItems: "center", justifyContent: "center", paddingLeft: 3 },
  avatar: { overflow: "hidden", backgroundColor: "rgba(0,182,215,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.52)", alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 13 },
  instructorAndTags: { width: "100%", height: 64, paddingHorizontal: 19, flexDirection: "row", alignItems: "center", gap: 7, overflow: "hidden" },
  instructor: { width: 116, flexDirection: "row", alignItems: "center", flexShrink: 0 },
  instructorCopy: { flex: 1, minWidth: 0, marginLeft: 6 },
  instructorLabel: { color: "#7F8892", fontFamily: "Archivo_400Regular", fontSize: 10, lineHeight: 12 },
  instructorName: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 18, lineHeight: 21 },
  tags: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  tag: { height: 30, minWidth: 0, maxWidth: "32%", paddingHorizontal: 9, borderRadius: 999, alignItems: "center", justifyContent: "center", flexShrink: 1 },
  styleTag: { maxWidth: "40%", backgroundColor: "#FFFFFF", flexDirection: "row", gap: 4 },
  tagText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 10 },
  styleTagText: { color: CYAN },
  actionCard: { flexShrink: 0, borderTopLeftRadius: 46, borderTopRightRadius: 46, backgroundColor: CARD, paddingHorizontal: 19, paddingTop: 24 },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 14 },
  purchaseHint: { flex: 1, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 20 },
  priceColumn: { alignItems: "flex-end" },
  priceLabel: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 16, lineHeight: 20 },
  price: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 34, lineHeight: 38 },
  primaryButton: { height: 50, marginTop: 16, borderRadius: 26, backgroundColor: CYAN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  cancelButton: { backgroundColor: RED },
  disabledButton: { backgroundColor: "rgba(255,255,255,0.12)" },
  primaryButtonText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 15 },
});
