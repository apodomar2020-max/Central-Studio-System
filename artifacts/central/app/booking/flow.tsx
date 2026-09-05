import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { pushOnce } from "@/utils/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { customFetch, useGetClass, useGetInstructor, useCreateBooking, useListSchedules } from "@workspace/api-client-react";

import { useAppContext, type Booking } from "@/contexts/AppContext";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import { nextStepRoute } from "@/services/authProfile";
import { compareSchedulesByNextOccurrence, getScheduleLabel, isBookableScheduleStatus, isMobileVisibleSchedule, mapApiClassWithScheduleToMobile, mapApiInstructorToMobile } from "@/data/apiAdapters";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";
import CentralBackButton from "@/components/CentralBackButton";
import { iosDisplayTextStyle } from "@/utils/iosTypography";
import ParticipantAvatar from "@/components/ParticipantAvatar";
import { DetailSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";
import { fetchClassPricing } from "@/services/classPricingService";
import { DEFAULT_CLASS_CAPACITY_ENABLED, fetchClassCapacitySettings } from "@/services/classCapacityService";
import { getBookingErrorMessage } from "@/services/bookingErrorMessages";
import DiscoveryClassCard from "@/components/DiscoveryClassCard";
import BookingFlowIcon from "@/components/booking/BookingFlowIcon";
import { getFriendlyPromoError } from "@/components/booking/promoError";
import { PACKAGE_AGE_BAND_LABELS, parsePackageAgeBand } from "@/utils/packageAgeBands";

type PaymentMethod = "online" | "cash" | "packageCredit";
type ParticipantCandidate = {
  participantType: "self" | "child";
  participantChildId: number | null;
  participantName: string;
  ageOnOccurrenceDate: number | null;
  eligible: boolean;
  reasonCode: string;
  existingBookingState: string | null;
};

type PromotionQuote = {
  eligible: boolean;
  reason: string | null;
  originalSubtotal: number;
  discountAmount: number;
  finalSubtotal: number;
  promotion: { id: number; name: string } | null;
  promotionCode: string | null;
};

function BookingProgress({ current }: { current: number }): React.ReactElement {
  const labels = ["Participant", "Payment", "Details"];
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressTrack}>
        {labels.map((label, index) => {
          const number = index + 1;
          const complete = number < current;
          const active = number === current;
          return (
            <React.Fragment key={label}>
              <View style={styles.progressItem}>
                <View style={[
                  styles.progressDot,
                  complete && styles.progressDotComplete,
                  active && styles.progressDotActive,
                ]}>
                  <Ionicons
                    name={complete ? "checkmark" : "alert"}
                    size={15}
                    color={complete ? "#FFFFFF" : "#071014"}
                  />
                </View>
                <Text style={styles.progressLabel}>{label}</Text>
              </View>
              {index < labels.length - 1 && (
                <View style={[
                  styles.progressLine,
                  index < current - 1 && styles.progressLineComplete,
                ]} />
              )}
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

function SectionDivider({ label }: { label: string }): React.ReactElement {
  return (
    <View style={styles.sectionDivider}>
      <View style={styles.sectionDividerLine} />
      <Text style={styles.sectionDividerText}>{label}</Text>
      <View style={styles.sectionDividerLine} />
    </View>
  );
}

function SelectionRadio({ selected, disabled }: { selected: boolean; disabled?: boolean }): React.ReactElement {
  return (
    <View style={[
      styles.selectionRadio,
      selected && styles.selectionRadioSelected,
      disabled && styles.selectionRadioDisabled,
    ]}>
      {selected && !disabled ? <View style={styles.selectionRadioFill} /> : null}
    </View>
  );
}

const INK = {
  bg: "#0A0B0D",     // --cs-ink-900
  card: "#15171B",   // --cs-ink-800
  raised: "#22262C", // --cs-ink-700
  border: "rgba(255,255,255,0.08)",
  text3: "#8E97A2",  // --cs-ink-300
  text4: "#6B747F",  // --cs-ink-400
};

export default function BookingFlowScreen() {
  const { classId, scheduleId, usePackage } = useLocalSearchParams<{ classId: string; scheduleId?: string; usePackage?: string }>();
  const { user, addBooking, children, bookings, userPackages } = useAppContext();
  const alert = useCentralAlert();
  const insets = useSafeAreaInsets();

  // ── Fetch class and instructor from the live API ──
  const numericClassId = Number(classId);
  const classQuery = useGetClass(numericClassId, {
    query: { queryKey: ["class", numericClassId], enabled: !!classId && !isNaN(numericClassId) },
  });
  const schedulesQuery = useListSchedules(
    { classId: numericClassId },
    { query: { queryKey: ["class-schedules", numericClassId], enabled: !!classId && !isNaN(numericClassId) } },
  );
  const queryClient = useQueryClient();
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
  const classCapacityEnabled =
    classCapacityQuery.data?.classCapacityEnabled ?? DEFAULT_CLASS_CAPACITY_ENABLED;
  const primarySchedule = schedulesQuery.data
    ? schedulesQuery.data.filter(isMobileVisibleSchedule).find((schedule) => String(schedule.id) === scheduleId) ??
      [...schedulesQuery.data].filter(isMobileVisibleSchedule).sort((a, b) => compareSchedulesByNextOccurrence(a, b))[0]
    : undefined;
  const cls = classQuery.data
    ? mapApiClassWithScheduleToMobile(classQuery.data, primarySchedule, classPricingQuery.data, classCapacityEnabled)
    : null;
  const participantCandidatesQuery = useQuery({
    queryKey: ["booking-participant-candidates", cls?.scheduleId, cls?.date],
    queryFn: () => customFetch<{ candidates: ParticipantCandidate[] }>(
      `/api/bookings/participant-candidates?scheduleId=${encodeURIComponent(String(cls!.scheduleId))}&occurrenceDate=${encodeURIComponent(cls!.date)}`,
    ),
    enabled: Boolean(cls?.scheduleId && cls?.date),
    staleTime: 0,
  });
  const participantCandidates = participantCandidatesQuery.data?.candidates ?? [];
  const selfCandidate = participantCandidates.find((candidate) => candidate.participantType === "self");
  const childCandidate = (childId: string) => participantCandidates.find(
    (candidate) => candidate.participantType === "child"
      && String(candidate.participantChildId) === String(childId),
  );
  const candidateReason = (candidate: ParticipantCandidate | undefined) => {
    if (!candidate) return "Eligibility unavailable";
    if (candidate.reasonCode === "PARTICIPANT_DOB_REQUIRED") return "Date of birth required";
    if (candidate.reasonCode === "EXISTING_BOOKING") return "Already booked";
    if (candidate.reasonCode === "EXISTING_ATTENDANCE") return "Already attended";
    if (candidate.reasonCode === "BELOW_MINIMUM_AGE") return "Below the minimum age for this class";
    if (candidate.reasonCode === "ABOVE_MAXIMUM_AGE") return "Above the maximum age for this class";
    if (candidate.reasonCode === "PARTICIPANT_NOT_ELIGIBLE") return "Not eligible for this age range";
    return candidate.eligible ? null : "Not eligible";
  };
  // Finance Batch 1 (Part F1): an already-booked participant must be
  // disabled, not merely rejected after submission. "Active" here mirrors
  // the backend's own DUPLICATE_BLOCKING_STATUSES (bookings.ts) — pending
  // OR confirmed blocks a duplicate; cancelled/rejected/attended do not.
  // Scoped to the EXACT occurrence (scheduleId + occurrenceDate/date), so a
  // past occurrence's booking never blocks re-booking a future one.
  const occurrenceBookings = cls
    ? bookings.filter((b) =>
        b.scheduleId != null
        && cls.scheduleId != null
        && String(b.scheduleId) === String(cls.scheduleId)
        && (b.occurrenceDate ?? b.date) === cls.date
        && (b.bookingStatus === "pending" || b.bookingStatus === "confirmed"),
      )
    : [];
  const selfAlreadyBooked = occurrenceBookings.some((b) => b.participantType === "self")
    || selfCandidate?.reasonCode === "EXISTING_BOOKING";
  const selfDisabled = participantCandidatesQuery.isLoading || !selfCandidate?.eligible;
  // Review Blocker 1: identity must be a stable id (children.id /
  // participantChildId), never participantName — two children can share a
  // name, names are editable, and casing/spacing can differ. The name
  // comparison below is a LEGACY FALLBACK ONLY, isolated to booking rows
  // that genuinely have no participantChildId (pre-dating the field being
  // captured) — every current/new booking row has one (see
  // myRoutes.ts/AppContext.tsx's mapMyBookingToLocal), so this fallback
  // should see zero real bookings going forward and exists only so an old
  // in-flight legacy row doesn't silently stop being detected at all.
  function childAlreadyBooked(child: { id: string; fullName: string }): boolean {
    return occurrenceBookings.some((booking) => {
      if (booking.participantType !== "child") return false;
      if (booking.participantChildId != null) {
        return String(booking.participantChildId) === String(child.id);
      }
      // Legacy fallback only for rows without a stable child ID.
      return booking.participantName.trim().toLowerCase() === child.fullName.trim().toLowerCase();
    });
  }

  const schedulePackageEligible = primarySchedule?.packageEligible ?? cls?.packageEligible ?? true;

  const instructorQuery = useGetInstructor(classQuery.data?.instructorId ?? 0, {
    query: { queryKey: ["instructor", classQuery.data?.instructorId ?? 0], enabled: !!classQuery.data?.instructorId },
  });
  const instructor = instructorQuery.data
    ? mapApiInstructorToMobile(instructorQuery.data)
    : null;

  // ── Create booking mutation ──
  const { mutateAsync: createBookingAsync } = useCreateBooking();

  const [step, setStep] = useState(1);
  const [participantType, setParticipantType] = useState<"self" | "child">("self");
  const [selectedChildId, setSelectedChildId] = useState<string | null>(children[0]?.id ?? null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [promoExpanded, setPromoExpanded] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoQuote, setPromoQuote] = useState<PromotionQuote | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [packageParamApplied, setPackageParamApplied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bookingFailed, setBookingFailed] = useState(false);
  const selectedChild = children.find((child) => child.id === selectedChildId);
  const hasSchedule = Boolean(cls?.scheduleId && cls?.dayOfWeek && cls?.startTime);
  const canBookSchedule = hasSchedule && isBookableScheduleStatus(cls?.scheduleStatus);
  const participantName =
    participantType === "self"
      ? user?.fullName ?? ""
      : selectedChild?.fullName ?? "Child";
  const participantChildId =
    participantType === "child" && selectedChild?.id
      ? Number(selectedChild.id)
      : null;
  const activePackages = userPackages.filter((pkg) =>
    pkg.status === "active"
    && pkg.remainingCredits > 0
    && pkg.participantType === participantType
    && (participantType === "self"
      ? pkg.participantChildId == null
      : Number(pkg.participantChildId) === participantChildId),
  );
  const packageCreditsRemaining = activePackages.reduce((sum, pkg) => sum + pkg.remainingCredits, 0);
  const selectedPackage = activePackages[0];
  const canUsePackageCredits = schedulePackageEligible && packageCreditsRemaining > 0;
  const shouldShowBuyCredits = packageCreditsRemaining <= 0;
  const classPackageAgeBand = parsePackageAgeBand(cls?.ageGroup) ?? "adults";
  const classPackageAgeLabel = PACKAGE_AGE_BAND_LABELS[classPackageAgeBand];
  const isPackageMode = paymentMethod === "packageCredit" && canUsePackageCredits;
  const grossPrice = cls?.price ?? 0;
  const finalPrice = isPackageMode ? 0 : (promoQuote?.finalSubtotal ?? grossPrice);

  useEffect(() => {
    if (!selectedChildId && children.length > 0) {
      setSelectedChildId(children[0].id);
    }
  }, [children, selectedChildId]);

  const eligibleChildren = children.filter(
    (child) => childCandidate(child.id)?.eligible && !childAlreadyBooked(child),
  );
  const hasEligibleChildren = eligibleChildren.length > 0;
  const isLoadingCandidates = participantCandidatesQuery.isLoading;

  // Step 1 eligibility gate. Reuses the SAME signals already driving each
  // participant card's own disabled state (selfDisabled / per-child
  // eligible+alreadyBooked) — not a parallel eligibility model. Also covers
  // the "no such child" case (selectedChild undefined) so a stale/removed
  // selectedChildId can never read as a valid selection.
  const isSelfSelectionValid = participantType === "self" && !selfDisabled;
  const isChildSelectionValid =
    participantType === "child" &&
    Boolean(selectedChild) &&
    Boolean(childCandidate(selectedChildId ?? "")?.eligible) &&
    !childAlreadyBooked(selectedChild!);
  const hasEligibleSelectedParticipant = isSelfSelectionValid || isChildSelectionValid;

  useEffect(() => {
    if (!participantCandidatesQuery.data) return;
    if (participantType === "self" && !selfCandidate?.eligible && hasEligibleChildren) {
      const firstEligibleChild = eligibleChildren[0];
      if (firstEligibleChild) {
        setParticipantType("child");
        setSelectedChildId(firstEligibleChild.id);
      }
    } else if (participantType === "child" && selectedChildId) {
      const currentCandidate = childCandidate(selectedChildId);
      const currentSelectedChild = children.find((c) => c.id === selectedChildId);
      // A selected child that has disappeared from `children` (removed /
      // refreshed away) must never read as "still eligible" just because a
      // stale server candidate record for that id happens to say eligible.
      const isStillEligible = Boolean(currentSelectedChild) && Boolean(currentCandidate?.eligible) && !childAlreadyBooked(currentSelectedChild!);
      if (!isStillEligible) {
        const nextEligible = eligibleChildren[0];
        if (nextEligible) {
          setSelectedChildId(nextEligible.id);
        } else if (selfCandidate?.eligible) {
          setParticipantType("self");
        }
      }
    }
  }, [participantCandidatesQuery.data, participantType, selectedChildId, children, selfCandidate]);

  useEffect(() => {
    if (!packageParamApplied && usePackage === "true" && canUsePackageCredits) {
      setPaymentMethod("packageCredit");
      setPackageParamApplied(true);
    } else if (paymentMethod === "packageCredit" && !canUsePackageCredits) {
      setPaymentMethod("cash");
    }
  }, [canUsePackageCredits, packageParamApplied, paymentMethod, usePackage]);

  useEffect(() => {
    if (paymentMethod === "packageCredit") {
      setPromoExpanded(false);
      setPromoCode("");
      setPromoQuote(null);
      setPromoError(null);
    }
  }, [paymentMethod]);

  // ── Guard: must be signed in ──
  if (!user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="lock-closed-outline" size={48} color="#6B747F" />
        <Text style={styles.centeredTitle}>Sign in required</Text>
        <Text style={styles.centeredDesc}>Please sign in to book a class</Text>
        <AppButton title="Sign In" onPress={() => router.replace("/auth/login")} />
      </View>
    );
  }

  // ── Guard: profile must be complete (Profile Completion Engine, Phase 4) ──
  if (user.profileCompletion && !user.profileCompletion.isComplete) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="person-circle-outline" size={48} color="#6B747F" />
        <Text style={styles.centeredTitle}>Complete your profile first</Text>
        <Text style={styles.centeredDesc}>Finish setting up your profile to book classes.</Text>
        <AppButton
          title="Complete Profile"
          onPress={() => pushOnce(nextStepRoute(user.profileCompletion!.nextStep) as never)}
        />
      </View>
    );
  }

  // ── Loading ──
  if (classQuery.isLoading || schedulesQuery.isLoading) {
    return <DetailSkeleton />;
  }

  // ── Offline ──
  if ((classQuery.isError && isOfflineError(classQuery.error)) || (schedulesQuery.isError && isOfflineError(schedulesQuery.error))) {
    return (
      <View style={[styles.container, { justifyContent: "center" }]}>
        <OfflineState onRetry={() => { classQuery.refetch(); schedulesQuery.refetch(); }} />
      </View>
    );
  }

  // ── Server error / not found ──
  if (classQuery.isError || schedulesQuery.isError || !cls) {
    return (
      <View style={[styles.container, { justifyContent: "center" }]}>
        {classQuery.isError || schedulesQuery.isError ? (
          <ErrorState onRetry={() => { classQuery.refetch(); schedulesQuery.refetch(); }} message="Couldn't load class. Please try again." />
        ) : (
          <ErrorState title="Class not found" message="This class may no longer be available." onRetry={() => router.back()} />
        )}
      </View>
    );
  }

  // ── Step advancement — defensive guard so progression is impossible even
  // if the CTA's disabled state is ever accidentally bypassed. Step 1 may
  // only advance with a currently selected, eligible participant; other
  // steps are unaffected (their own guards are unchanged).
  function handleContinue() {
    if (!canBookSchedule) return;
    if (step === 1 && !hasEligibleSelectedParticipant) return;
    if (step === 2 && paymentMethod === "online") return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep(step + 1);
  }

  async function validatePromoCode(): Promise<PromotionQuote | null> {
    const normalizedCode = promoCode.trim().toUpperCase();
    const promoScheduleId = cls?.scheduleId;
    if (!normalizedCode || isPackageMode || !promoScheduleId) {
      setPromoQuote(null);
      setPromoError(normalizedCode ? "Promo codes are only available with cash payment." : null);
      return null;
    }

    setPromoChecking(true);
    setPromoError(null);
    try {
      const quote = await customFetch<PromotionQuote>("/api/promotions/validate", {
        method: "POST",
        body: JSON.stringify({ scheduleId: Number(promoScheduleId), promoCode: normalizedCode }),
      });
      if (!quote.eligible) {
        setPromoQuote(null);
        setPromoError(getFriendlyPromoError(quote.reason ?? "This promo code is not eligible."));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return null;
      }
      setPromoCode(normalizedCode);
      setPromoQuote(quote);
      setPromoError(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return quote;
    } catch (error) {
      setPromoQuote(null);
      setPromoError(getFriendlyPromoError(error));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return null;
    } finally {
      setPromoChecking(false);
    }
  }

  // ── Confirm booking — POST to API then update local state ──
  async function handleConfirm() {
    if (!cls || !user) return;
    if (!hasSchedule) {
      alert.show({
        tone: "warning",
        title: "Schedule not set",
        message: "This class cannot be booked until the studio adds a day and time.",
      });
      return;
    }
    if (!canBookSchedule) {
      const isCancelled = cls.scheduleStatus === "cancelled";
      alert.show({
        tone: "warning",
        title: isCancelled ? "Class cancelled" : "Class unavailable",
        message: isCancelled
          ? "This class schedule has been cancelled and cannot be booked."
          : "This class schedule is not currently accepting bookings.",
      });
      return;
    }
    if (paymentMethod === "packageCredit" && !canUsePackageCredits) {
      alert.show({
        tone: "warning",
        title: "Package credits unavailable",
        message: "This class is not eligible for package credits. Please choose Pay at Studio.",
      });
      setPaymentMethod("cash");
      return;
    }
    if (participantType === "child" && (!participantChildId || !Number.isInteger(participantChildId))) {
      alert.show({
        tone: "warning",
        title: "Child profile unavailable",
        message: "Please choose a saved child profile before booking.",
      });
      return;
    }
    let confirmedPromoQuote = promoQuote;
    if (!isPackageMode && promoCode.trim()) {
      const normalizedCode = promoCode.trim().toUpperCase();
      if (!confirmedPromoQuote || confirmedPromoQuote.promotionCode !== normalizedCode) {
        const checked = await validatePromoCode();
        if (!checked) return;
        confirmedPromoQuote = checked;
      }
    }
    const confirmedFinalPrice = isPackageMode ? 0 : (confirmedPromoQuote?.finalSubtotal ?? grossPrice);
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      const notes = [
        participantType === "child" ? `Participant: ${participantName}` : null,
        isPackageMode && selectedPackage
          ? `Package credit intent: ${selectedPackage.packageTitle} (#${selectedPackage.id})`
          : null,
      ].filter(Boolean).join("\n") || undefined;

      // 1. Create booking in the database
      // Policy: every student booking starts as PENDING — Admin confirms it.
      // Package credits are authoritatively resolved and deducted by the booking
      // transaction for the selected participant.
      const apiBookingStatus = "pending";
      // F-17: First Class Free is permanently retired — a class price of 0
      // must never be silently reinterpreted as the retired free-booking
      // mode. Only package-credit bookings are "not_required"/non-cash;
      // every other booking (regardless of price) goes through the normal
      // pay_at_studio flow — the backend's own resolved price is always
      // authoritative here anyway (server-side stale-price guard below).
      const apiPaymentStatus = isPackageMode ? "not_required" : "pending_payment";
      const apiPaymentMode = isPackageMode ? "package_credit" : "pay_at_studio";
      const apiBooking = await createBookingAsync({
        data: {
          studentName: participantName,
          studentEmail: user.email,
          studentPhone: user.phone,
          participantType,
          participantChildId: participantType === "child" ? participantChildId : null,
          bookingScope: participantType,
          classId: numericClassId,
          scheduleId: primarySchedule?.id,
          // packageId kept for backward-compat; packageOrderId is the authoritative FK (credit ledger)
          packageId: isPackageMode && selectedPackage ? Number(selectedPackage.id) : undefined,
          packageOrderId: isPackageMode && selectedPackage ? Number(selectedPackage.id) : undefined,
          status: apiBookingStatus,
          bookingStatus: apiBookingStatus,
          paymentStatus: apiPaymentStatus,
          paymentMode: apiPaymentMode,
          notes,
          // Stale-price guard: only meaningful for a direct-payment booking —
          // the backend re-resolves and rejects (409 booking_price_changed,
          // nothing written) if this no longer matches. Omitted for
          // package/free bookings, exactly like the backend expects.
          expectedPriceEgp: apiPaymentMode === "pay_at_studio" ? grossPrice : undefined,
          promoCode: apiPaymentMode === "pay_at_studio" ? confirmedPromoQuote?.promotionCode ?? undefined : undefined,
          expectedFinalPriceEgp: apiPaymentMode === "pay_at_studio" && confirmedPromoQuote
            ? confirmedPromoQuote.finalSubtotal
            : undefined,
        },
      });

      // 2. Mirror booking in local AppContext so the Bookings tab reflects it immediately
      const bookingNumber = "CS" + String(apiBooking.id).padStart(6, "0");
      const localBooking: Booking = {
        id: String(apiBooking.id),
        classId: cls.id,
        scheduleId: cls.scheduleId,
        // Server-computed occurrence (falls back to the displayed occurrence date).
        occurrenceDate: apiBooking.occurrenceDate ?? cls.date,
        className: cls.title,
        danceType: cls.categoryName,
        instructorName: instructor?.name ?? "Instructor",
        instructorImage: instructor?.photoUrl,
        date: cls.date,
        time: cls.endTime ? `${cls.startTime} - ${cls.endTime}` : cls.startTime,
        scheduleLabel: getScheduleLabel(cls),
        duration: cls.duration,
        location: cls.location,
        price: confirmedFinalPrice,
        participantType,
        participantName,
        participantChildId: participantType === "child" ? participantChildId : null,
        paymentMethod,
        paymentStatus: apiPaymentStatus,
        bookingStatus: apiBookingStatus,
        bookingType: isPackageMode ? "package" : "single",
        userPackageId: isPackageMode ? selectedPackage?.id : undefined,
        attendanceStatus: "booked",
        bookingNumber,
        createdAt: apiBooking.createdAt ?? new Date().toISOString(),
      };
      await addBooking(localBooking);

      setLoading(false);
      router.replace({
        pathname: "/booking/confirmation",
        params: {
          bookingNumber,
          classId: cls.id,
          className: cls.title,
          categoryName: cls.categoryName,
          level: cls.level,
          ageLabel: cls.ageRangeLabel || cls.ageGroup,
          participantName,
          participantType,
          paymentMethod,
          scheduleDate: apiBooking.occurrenceDate ?? cls.date,
          startTime: cls.startTime,
          endTime: cls.endTime,
          duration: cls.duration,
          location: cls.location,
          instructorName: instructor?.name ?? "Instructor",
          finalPrice: String(confirmedFinalPrice),
          discountAmount: String(confirmedPromoQuote?.discountAmount ?? 0),
          creditsBefore: String(packageCreditsRemaining),
          creditsUsed: isPackageMode ? "1" : "0",
        },
      });
    } catch (err) {
      setLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Friendly handling for the backend duplicate-booking guard (HTTP 409 /
      // code "duplicate_booking") instead of the generic failure screen.
      const errorData = (err as { data?: { code?: string; error?: string; message?: string; currentPriceEgp?: number | null } })?.data;
      const code = errorData?.code ?? errorData?.error;
      const msg = err instanceof Error ? err.message : "";
      const friendlyError = getBookingErrorMessage(code);
      if (friendlyError) {
        alert.show({
          tone: "warning",
          title: friendlyError.title,
          message: friendlyError.message,
        });
        return;
      }
      if (code === "booking_attempt_limit_reached" || /booking_attempt_limit_reached/i.test(msg)) {
        alert.show({
          tone: "warning",
          title: "Booking limit reached",
          message: "You have reached the daily booking limit for this class. Please contact the studio if you need help.",
        });
        return;
      }
      if (code === "booking_price_changed" || /booking_price_changed/i.test(msg)) {
        const updated = errorData?.currentPriceEgp;
        // Nothing was written server-side, but the locally-cached price is
        // now known-stale — invalidate it so going back actually shows the
        // corrected price instead of the same stale one from cache.
        queryClient.invalidateQueries({ queryKey: ["class-pricing"] });
        alert.show({
          tone: "warning",
          title: "Price updated",
          message: updated != null
            ? `The price for this class changed to EGP ${updated}. Nothing was charged — please review and confirm again.`
            : "The price for this class changed since you opened this screen. Nothing was charged — please review and confirm again.",
          actions: [{ label: "Review class", tone: "primary", onPress: () => router.back() }],
        });
        return;
      }
      if (code === "promotion_not_eligible" || code === "promotion_changed") {
        setPromoQuote(null);
        setPromoError(errorData?.message
          ? errorData.message
          : errorData?.error && errorData.error !== code
            ? errorData.error
          : code === "promotion_changed"
            ? "The promotion changed. Please review the updated total."
            : "This promo code is no longer eligible.");
        setStep(3);
        alert.show({
          tone: "warning",
          title: code === "promotion_changed" ? "Promotion updated" : "Promo code unavailable",
          message: code === "promotion_changed"
            ? "The offer changed before confirmation. Nothing was booked — please check the code again."
            : "The promo code could not be applied. Nothing was booked — please review it and try again.",
        });
        return;
      }
      if (code === "duplicate_booking" || /duplicate_booking|already have an active booking/i.test(msg)) {
        alert.show({
          tone: "warning",
          title: "Already booked",
          message: "You already have an active booking for this class. You can cancel it from the Classes screen first.",
          actions: [{ label: "OK", tone: "primary", onPress: () => router.back() }],
        });
        return;
      }
      setBookingFailed(true);
    }
  }

  function renderPriceSummary(): React.ReactElement {
    return (
      <View style={styles.priceSummaryRows}>
        {isPackageMode ? (
          <>
            <View style={styles.priceLine}><Text style={styles.priceLabel}>Available Credits</Text><Text style={styles.priceValue}>{packageCreditsRemaining}</Text></View>
            <View style={styles.priceLine}><Text style={styles.priceLabel}>Credits Used</Text><Text style={styles.priceValue}>1</Text></View>
            <View style={styles.priceRule} />
            <View style={styles.priceLine}><Text style={styles.totalLabel}>Remaining</Text><Text style={styles.totalValue}>{Math.max(0, packageCreditsRemaining - 1)}</Text></View>
          </>
        ) : (
          <>
            <View style={styles.priceLine}><Text style={styles.priceLabel}>Price</Text><Text style={styles.priceValue}>{grossPrice} EGP</Text></View>
            <View style={styles.priceLine}><Text style={styles.priceLabel}>Tax</Text><Text style={styles.priceValue}>0 EGP</Text></View>
            {promoQuote ? (
              <View style={styles.priceLine}><Text style={styles.priceLabel}>Discount</Text><Text style={styles.priceValue}>-{promoQuote.discountAmount} EGP</Text></View>
            ) : null}
            <View style={styles.priceRule} />
            <View style={styles.priceLine}><Text style={styles.totalLabel}>Total Price</Text><Text style={styles.totalValue}>{finalPrice} EGP</Text></View>
          </>
        )}
      </View>
    );
  }

  // ── Failure result screen (design parity: ResultScreen) ──
  if (bookingFailed) {
    return (
      <View style={[styles.container, styles.resultScreen, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <LinearGradient
          colors={[colors.error + "22", INK.bg]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.6 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.resultIconRing, { backgroundColor: colors.error + "1F" }]}>
          <View style={[styles.resultIconCircle, { backgroundColor: colors.error }]}>
            <Ionicons name="close" size={40} color="#FFFFFF" />
          </View>
        </View>
        <Text style={styles.resultTitle}>Booking Failed</Text>
        <Text style={styles.resultSub}>
          Something went wrong. Please check your connection and try again, or contact the studio.
        </Text>
        <View style={styles.resultButtons}>
          <AppButton
            title="Try Again"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setBookingFailed(false); }}
            fullWidth
            size="lg"
          />
          <AppButton
            title="Back to Class"
            onPress={() => router.back()}
            variant="ghost"
            fullWidth
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <CentralBackButton
          onPress={() => {
            if (step > 1) setStep(step - 1);
            else router.back();
          }}
          style={styles.backBtn}
        />
        <Text style={styles.headerTitle}>
          {step === 1 ? "BOOK CLASS" : step === 2 ? "PAYMENT METHOD" : "DETAILS"}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <LinearGradient
        colors={["rgba(0,182,215,0.34)", "rgba(0,182,215,0.04)", "transparent"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.1, y: 1 }}
        pointerEvents="none"
        style={styles.topGlow}
      />

      <BookingProgress current={step} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: step === 3 ? 250 : 100 }]}
      >
        {/* ── Step 1: Participant ── */}
        {step === 1 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Choose Who Will Attend</Text>

            <View style={styles.classPreview}>
              <DiscoveryClassCard item={cls} instructor={instructor ?? undefined} onSelect={() => undefined} />
            </View>

            <SectionDivider label="FOR" />
            <Text style={styles.participantGroupLabel}>My Self</Text>

            <TouchableOpacity
              onPress={() => {
                if (selfDisabled) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setParticipantType("self");
              }}
              disabled={selfDisabled}
              style={[
                styles.participantCard,
                participantType === "self" && styles.participantCardSelected,
                selfDisabled && styles.disabledCard,
              ]}
            >
              <ParticipantAvatar
                type="self"
                name={user.fullName}
                avatarUrl={user.avatarUrl}
                size={48}
                selected={participantType === "self"}
              />
              <View style={styles.participantText}>
                <Text style={styles.participantLabel}>{user.fullName}</Text>
              </View>
              {selfAlreadyBooked ? (
                <Text style={styles.alreadyBookedBadge}>Already booked</Text>
              ) : selfDisabled ? (
                <Text style={styles.alreadyBookedBadge}>{candidateReason(selfCandidate)}</Text>
              ) : <SelectionRadio selected={participantType === "self"} />}
            </TouchableOpacity>

            <Text style={styles.participantGroupLabel}>My Childs</Text>

            {!children.length ? (
              <AppButton
                title="Add Child Profile"
                onPress={() => pushOnce("/(tabs)/profile" as any)}
                variant="ghost"
                fullWidth
              />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.childPicker}
              >
                {children.map((child) => {
                  const isAlreadyBooked = childAlreadyBooked(child);
                  const candidate = childCandidate(child.id);
                  const disabled = isAlreadyBooked || !candidate?.eligible;
                  return (
                    <TouchableOpacity
                      key={child.id}
                      onPress={() => {
                        if (disabled) return;
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setParticipantType("child");
                        setSelectedChildId(child.id);
                      }}
                      style={[
                        styles.childOption,
                        participantType === "child" && selectedChildId === child.id && styles.childOptionSelected,
                        disabled && styles.disabledCard,
                      ]}
                    >
                      <ParticipantAvatar
                        type="child"
                        name={child.fullName}
                        gender={child.gender}
                        size={44}
                        selected={participantType === "child" && selectedChildId === child.id}
                      />
                      <View style={styles.childTextBlock}>
                        <Text style={styles.childName} numberOfLines={1} ellipsizeMode="tail">{child.fullName}</Text>
                        <Text style={[
                          styles.participantSub,
                          participantType === "child" && selectedChildId === child.id && styles.participantSubSelected,
                        ]} numberOfLines={1} ellipsizeMode="tail">
                          {candidate?.ageOnOccurrenceDate != null
                            ? `${candidate.ageOnOccurrenceDate} YEARS`
                            : candidateReason(candidate) ?? ""}
                        </Text>
                      </View>
                      {disabled ? (
                        <View style={styles.ineligibleWrap}>
                          <View style={styles.ineligibleBadge}>
                            <Text style={styles.ineligibleTitle}>NOT ELIGIBLE</Text>
                          </View>
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel="Why this participant is not eligible"
                            style={styles.ineligibleInfo}
                            onPress={(event) => {
                              event.stopPropagation();
                              void Haptics.selectionAsync();
                              alert.show({
                                tone: "info",
                                title: "Not eligible",
                                message: isAlreadyBooked
                                  ? "This participant is already booked for this class."
                                  : candidateReason(candidate) || "This participant is not eligible for this class.",
                              });
                            }}
                          >
                            <Ionicons name="information" size={14} color="#FFFFFF" />
                          </TouchableOpacity>
                        </View>
                      ) : <SelectionRadio selected={participantType === "child" && selectedChildId === child.id} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}

        {/* ── Step 2: Payment ── */}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Choose Payment Method</Text>

            <View style={styles.classPreview}>
              <DiscoveryClassCard item={cls} instructor={instructor ?? undefined} onSelect={() => undefined} />
            </View>

            <SectionDivider label="PAYMENT METHOD" />

            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setPaymentMethod("cash");
              }}
              style={[styles.paymentOption, paymentMethod === "cash" && styles.paymentOptionCashSelected]}
            >
              <BookingFlowIcon name="cash" size={42} />
              <View style={styles.paymentOptionCopy}>
                <Text style={[styles.paymentOptionTitle, paymentMethod === "cash" && styles.paymentOptionTitleOnCyan]}>CASH</Text>
                <Text style={[styles.paymentOptionDesc, paymentMethod === "cash" && styles.paymentOptionDescOnCyan]}>
                  Pay In Cash When You Arrive At The Studio
                </Text>
              </View>
              <SelectionRadio selected={paymentMethod === "cash"} />
            </TouchableOpacity>

            {canUsePackageCredits ? (
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setPaymentMethod("packageCredit");
                }}
                style={[styles.paymentOption, paymentMethod === "packageCredit" && styles.paymentOptionSelected]}
              >
                <BookingFlowIcon name="credit" size={42} />
                <View style={styles.paymentOptionCopy}>
                  <Text style={[
                    styles.paymentOptionTitle,
                    styles.creditTitle,
                    paymentMethod === "packageCredit" && styles.paymentOptionTitleOnCyan,
                  ]}>USE CREDIT</Text>
                  <Text style={[
                    styles.paymentOptionDesc,
                    styles.creditDesc,
                    paymentMethod === "packageCredit" && styles.paymentOptionDescOnCyan,
                  ]}>Use 1 Active Package Credit For This Class</Text>
                </View>
                <SelectionRadio selected={paymentMethod === "packageCredit"} />
              </TouchableOpacity>
            ) : null}

            {shouldShowBuyCredits ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Buy credits from Package Center"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  pushOnce({ pathname: "/package-center", params: { ageBand: classPackageAgeBand } } as never);
                }}
                style={styles.paymentOption}
              >
                <BookingFlowIcon name="credit" size={42} />
                <View style={styles.paymentOptionCopy}>
                  <Text style={[styles.paymentOptionTitle, styles.creditTitle]}>BUY CREDIT</Text>
                  <Text style={[styles.paymentOptionDesc, styles.creditDesc]}>No Credits Available. Buy A Package For {classPackageAgeLabel} To Book This Class</Text>
                </View>
                <BookingFlowIcon name="route" size={22} />
              </TouchableOpacity>
            ) : null}

            <View style={[styles.paymentOption, styles.paymentOptionDisabled]}>
              <BookingFlowIcon name="online" size={42} />
              <View style={styles.paymentOptionCopy}>
                <Text style={styles.paymentOptionTitle}>ONLINE</Text>
                <Text style={styles.paymentOptionDesc}>Online Card, Instapay, Wallet, Apple Pay</Text>
              </View>
              <Text style={styles.comingSoon}>Coming Soon</Text>
            </View>
          </View>
        )}

        {/* ── Step 3: Details ── */}
        {step === 3 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Confirm Booking Details</Text>

            <View style={styles.detailsSummary}>
              <View style={styles.detailRow}>
                {participantType === "self" ? (
                  <ParticipantAvatar type="self" name={participantName} avatarUrl={user.avatarUrl} size={42} />
                ) : (
                  <ParticipantAvatar type="child" name={participantName} gender={selectedChild?.gender} size={42} />
                )}
                <View style={styles.detailRowCopy}>
                  <Text style={styles.detailEyebrow}>{participantType === "self" ? "My Self" : "My Child"}</Text>
                  <Text style={styles.detailValue}>{participantName}</Text>
                </View>
              </View>
              <View style={styles.dashedDivider} />
              <View style={styles.detailRow}>
                <BookingFlowIcon name={isPackageMode ? "credit" : "cash"} size={42} />
                <View style={styles.detailRowCopy}>
                  <Text style={styles.detailValue}>
                    {isPackageMode ? "USE CREDIT" : "CASH"}
                  </Text>
                  <Text style={styles.detailHint}>
                    {isPackageMode ? "Use 1 Active Package Credit" : "Pay In Cash When You Arrive At The Studio"}
                  </Text>
                </View>
              </View>
              <View style={styles.dashedDivider} />
              <View style={styles.detailRow}>
                <BookingFlowIcon name={isPackageMode ? "credit" : "cash"} size={42} />
                <View style={styles.detailRowCopy}>
                  <Text style={styles.detailValue}>{isPackageMode ? "1 CREDIT" : `${grossPrice} EGP`}</Text>
                  <Text style={styles.detailHint}>{isPackageMode ? "Credit To Be Used" : "Original Class Price"}</Text>
                </View>
              </View>
              <View style={styles.dashedDivider} />
              <View style={styles.detailRow}>
                <BookingFlowIcon name="location" size={42} />
                <View style={styles.detailRowCopy}>
                  <Text style={styles.detailValue}>{cls.location.toUpperCase()}</Text>
                  <Text style={styles.detailHint}>Location</Text>
                </View>
              </View>
            </View>

            {!isPackageMode ? (
              <View style={styles.promoCard}>
                <View style={styles.promoHeader}>
                  <BookingFlowIcon name="promo" size={28} />
                  <Text style={styles.promoTitle}>Promo Code</Text>
                  {promoExpanded ? (
                    <View style={styles.promoInputWrap}>
                      <TextInput
                        value={promoCode}
                        onChangeText={(value) => {
                          setPromoCode(value.toUpperCase());
                          setPromoQuote(null);
                          setPromoError(null);
                        }}
                        onBlur={() => { void validatePromoCode(); }}
                        onSubmitEditing={() => { void validatePromoCode(); }}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        returnKeyType="done"
                        placeholder="ENTER CODE"
                        placeholderTextColor="#777777"
                        style={styles.promoInput}
                      />
                      {promoChecking ? (
                        <ActivityIndicator size="small" color={colors.studio.primary} />
                      ) : promoQuote ? (
                        <Ionicons name="checkmark-circle" size={20} color="#39C95A" />
                      ) : promoError ? (
                        <Ionicons name="close-circle" size={20} color="#FF3B30" />
                      ) : null}
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.promoTap} onPress={() => setPromoExpanded(true)}>
                      <Text style={styles.promoTapText}>Tap</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {promoExpanded && promoError ? <Text style={styles.promoError}>{promoError}</Text> : null}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <View style={[
        step === 3 ? styles.detailsFooter : styles.footer,
        { paddingBottom: Platform.OS === "web" ? 20 : Math.max(insets.bottom, 8) },
      ]}>
        {step === 3 ? (
          <>
            {renderPriceSummary()}
            <AppButton
              title={isPackageMode ? "Confirm Package Booking" : "Confirm Booking"}
              onPress={handleConfirm}
              loading={loading}
              fullWidth
              size="lg"
              style={styles.roundedCta}
            />
          </>
        ) : (
          <AppButton
            title={!hasSchedule ? "Schedule Not Set" : canBookSchedule ? "Continue" : cls?.scheduleStatus === "cancelled" ? "Class Cancelled" : "Class Unavailable"}
            onPress={handleContinue}
            disabled={!canBookSchedule || (step === 1 && !hasEligibleSelectedParticipant)}
            fullWidth
            size="lg"
            style={styles.roundedCta}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  centered: { justifyContent: "center", alignItems: "center", gap: 12, padding: 24 },
  centeredTitle: { fontSize: 20, fontFamily: "Archivo_600SemiBold", color: "#FFFFFF" },
  centeredDesc: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#8E97A2" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 8, zIndex: 2,
  },
  backBtn: {
    width: 40, height: 40,
  },
  headerTitle: { fontSize: 22, fontFamily: "Anton_400Regular", color: "#FFFFFF", letterSpacing: 0.2, ...iosDisplayTextStyle(22, 27) },
  topGlow: { position: "absolute", top: 0, right: 0, width: "78%", height: 118, transform: [{ skewY: "-10deg" }] },
  scroll: { paddingHorizontal: 20 },
  stepContent: { gap: 12 },
  stepTitle: { fontSize: 22, fontFamily: "Archivo_700Bold", color: "#FFFFFF", marginBottom: 4 },
  resultScreen: { alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 18 },
  resultIconRing: { width: 110, height: 110, borderRadius: 55, alignItems: "center", justifyContent: "center" },
  resultIconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 40, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase", textAlign: "center", letterSpacing: 0.5, ...iosDisplayTextStyle(40, 47) },
  resultSub: { fontSize: 14, fontFamily: "Archivo_400Regular", color: INK.text3, textAlign: "center", lineHeight: 21, maxWidth: 300 },
  resultButtons: { width: "100%", gap: 10, marginTop: 8 },
  participantCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    minHeight: 56, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 28, backgroundColor: "#012C31",
  },
  participantCardSelected: { backgroundColor: colors.studio.primary },
  disabledCard: { opacity: 0.5 },
  participantIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  participantText: { flex: 1 },
  participantLabel: { fontSize: 19, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase" },
  participantSub: { fontSize: 14, lineHeight: 16, fontFamily: "Archivo_400Regular", color: "#A3ABB4", marginTop: 0 },
  participantSubSelected: { color: "#012329", fontFamily: "Archivo_600SemiBold" },
  checkCircle: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  childPicker: { gap: 10, paddingRight: 24 },
  childOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: 310,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 29,
    backgroundColor: "#012C31",
  },
  childOptionSelected: { backgroundColor: colors.studio.primary },
  childAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  childTextBlock: { flex: 1, minWidth: 0 },
  childName: { fontSize: 18, lineHeight: 20, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase" },
  alreadyBookedBadge: {
    fontSize: 12, fontFamily: "Archivo_600SemiBold", color: "#A3ABB4",
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)",
  },
  summaryCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  summaryRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
    paddingHorizontal: 16, paddingVertical: 13,
  },
  summaryLabel: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#8E97A2", flexShrink: 0 },
  summaryValue: { fontSize: 13, fontFamily: "Archivo_500Medium", color: "#FFFFFF", textAlign: "right", flex: 1, minWidth: 0 },
  priceValueWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
  },
  divider: { height: 1 },
  paymentCard: { borderRadius: 16, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  paymentCardDisabled: { opacity: 0.45 },
  paymentGradient: { padding: 18, gap: 8 },
  paymentTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  paymentIconCircle: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  recommendedBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  recommendedText: { fontSize: 9, fontFamily: "Archivo_700Bold", color: "#000", letterSpacing: 0.8 },
  paymentTitle: { fontSize: 18, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  paymentDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#8E97A2", lineHeight: 18 },
  paymentAmount: { fontSize: 22, fontFamily: "Archivo_700Bold", ...iosDisplayTextStyle(22, 26, "archivo") },
  warningBanner: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "flex-start" },
  warningText: { fontSize: 13, fontFamily: "Archivo_500Medium", flex: 1, lineHeight: 18 },
  footer: {
    paddingHorizontal: 20, paddingTop: 12,
    backgroundColor: "#0A0B0D",
  },
  detailsFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
    backgroundColor: "#012C31",
  },
  roundedCta: { borderRadius: 999 },
  progressWrap: { paddingHorizontal: 28, paddingTop: 6, paddingBottom: 16, zIndex: 2 },
  progressTrack: { flexDirection: "row", alignItems: "flex-start" },
  progressItem: { alignItems: "center", width: 74 },
  progressDot: { width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#F2F2F2" },
  progressDotComplete: { backgroundColor: colors.studio.primary },
  progressDotActive: { backgroundColor: "#FFC400" },
  progressLabel: { marginTop: 5, fontSize: 13, fontFamily: "Archivo_500Medium", color: "#FFFFFF" },
  progressLine: { flex: 1, height: 5, marginHorizontal: -18, marginTop: 10, backgroundColor: "#E7E7E7" },
  progressLineComplete: { backgroundColor: colors.studio.primary },
  classPreview: { width: "100%", marginTop: 2 },
  sectionDivider: { flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 40, marginVertical: 5 },
  sectionDividerLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.65)" },
  sectionDividerText: { fontSize: 21, fontFamily: "Anton_400Regular", color: "#FFFFFF", ...iosDisplayTextStyle(21, 25) },
  participantGroupLabel: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#FFFFFF", marginLeft: 2 },
  selectionRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.studio.primary, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  selectionRadioSelected: { borderColor: "#FFFFFF" },
  selectionRadioDisabled: { opacity: 0.35 },
  selectionRadioFill: { width: 13, height: 13, borderRadius: 7, backgroundColor: "#FFFFFF" },
  ineligibleWrap: { width: 126, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  ineligibleBadge: { minWidth: 96, borderRadius: 16, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "#E80D1A", alignItems: "center" },
  ineligibleTitle: { fontSize: 10, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  ineligibleInfo: { width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, borderColor: "#FF2A32", backgroundColor: "rgba(255,42,50,0.16)", alignItems: "center", justifyContent: "center" },
  paymentOption: { minHeight: 64, borderRadius: 32, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: "#012C31" },
  paymentOptionCashSelected: { backgroundColor: colors.studio.primary },
  paymentOptionSelected: { backgroundColor: colors.studio.primary },
  paymentOptionDisabled: { opacity: 0.55 },
  paymentOptionCopy: { flex: 1 },
  paymentOptionTitle: { fontSize: 19, fontFamily: "Archivo_700Bold", color: colors.studio.primary },
  paymentOptionTitleOnCyan: { color: "#FFFFFF" },
  paymentOptionDesc: { marginTop: 2, fontSize: 11, lineHeight: 14, fontFamily: "Archivo_400Regular", color: "#8E97A2" },
  paymentOptionDescOnCyan: { color: "#FFFFFF" },
  creditTitle: { color: "#FFC400" },
  creditDesc: { color: "#FFC400" },
  comingSoon: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: "#A3ABB4" },
  detailsSummary: { paddingHorizontal: 20, backgroundColor: "rgba(8,10,11,0.72)" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 58, paddingVertical: 7 },
  detailRowCopy: { flex: 1 },
  detailEyebrow: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: "#FFFFFF" },
  detailValue: { fontSize: 22, lineHeight: 26, fontFamily: "Anton_400Regular", color: colors.studio.primary, textTransform: "uppercase" },
  detailHint: { marginTop: 1, fontSize: 13, lineHeight: 17, fontFamily: "Archivo_400Regular", color: "#FFFFFF" },
  dashedDivider: { height: 1, borderTopWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.32)" },
  promoCard: { borderRadius: 20, padding: 15, backgroundColor: "#FFE7A5" },
  promoHeader: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 10 },
  promoTitle: { flex: 1, minWidth: 80, fontSize: 17, fontFamily: "Archivo_700Bold", color: "#090909" },
  promoTap: { minWidth: 90, height: 38, borderRadius: 19, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
  promoTapText: { fontSize: 12, fontFamily: "Archivo_500Medium", color: "#FFFFFF" },
  promoInputWrap: { width: "48%", maxWidth: 180, minWidth: 130, height: 42, borderRadius: 9, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFFFFF" },
  promoInput: { flex: 1, minWidth: 0, paddingVertical: 8, fontSize: 14, fontFamily: "Archivo_700Bold", color: "#111111", textAlign: "center" },
  promoError: { marginTop: 6, marginLeft: 38, fontSize: 10, lineHeight: 13, fontFamily: "Archivo_500Medium", color: "#D92D20" },
  priceSummaryRows: { gap: 5 },
  priceLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 18 },
  priceLabel: { fontSize: 18, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  priceValue: { fontSize: 22, fontFamily: "Anton_400Regular", color: colors.studio.primary },
  priceRule: { height: 1, borderTopWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.5)", marginVertical: 1 },
  totalLabel: { fontSize: 27, fontFamily: "Anton_400Regular", color: "#FFFFFF" },
  totalValue: { fontSize: 27, fontFamily: "Anton_400Regular", color: colors.studio.primary },
});
