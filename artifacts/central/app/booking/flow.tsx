import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useGetClass, useGetInstructor, useCreateBooking, useListSchedules } from "@workspace/api-client-react";

import { useAppContext, type Booking } from "@/contexts/AppContext";
import { nextStepRoute } from "@/services/authProfile";
import { compareSchedulesByNextOccurrence, getScheduleLabel, isBookableScheduleStatus, isMobileVisibleSchedule, mapApiClassWithScheduleToMobile, mapApiInstructorToMobile } from "@/data/apiAdapters";
import colors from "@/constants/colors";
import StepIndicator from "@/components/StepIndicator";
import AppButton from "@/components/AppButton";
import { iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import ParticipantAvatar from "@/components/ParticipantAvatar";
import { DetailSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";
import { DEFAULT_SINGLE_CLASS_PRICE_EGP, fetchClassPricing } from "@/services/classPricingService";

type PaymentMethod = "online" | "cash" | "packageCredit";

const INK = {
  bg: "#0A0B0D",     // --cs-ink-900
  card: "#15171B",   // --cs-ink-800
  raised: "#22262C", // --cs-ink-700
  border: "rgba(255,255,255,0.08)",
  text3: "#8E97A2",  // --cs-ink-300
  text4: "#6B747F",  // --cs-ink-400
};

const NEW_MEMBER_OFFER_TITLE = "New Member Welcome";

export default function BookingFlowScreen() {
  const { classId, scheduleId, usePackage } = useLocalSearchParams<{ classId: string; scheduleId?: string; usePackage?: string }>();
  const { user, addBooking, children, bookings, userPackages } = useAppContext();
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
  const classPricingQuery = useQuery({
    queryKey: ["class-pricing"],
    queryFn: fetchClassPricing,
    staleTime: 5 * 60 * 1000,
  });
  const singleClassPriceEgp =
    classPricingQuery.data?.singleClassPriceEgp ?? DEFAULT_SINGLE_CLASS_PRICE_EGP;
  const primarySchedule = schedulesQuery.data
    ? schedulesQuery.data.filter(isMobileVisibleSchedule).find((schedule) => String(schedule.id) === scheduleId) ??
      [...schedulesQuery.data].filter(isMobileVisibleSchedule).sort((a, b) => compareSchedulesByNextOccurrence(a, b))[0]
    : undefined;
  const cls = classQuery.data
    ? mapApiClassWithScheduleToMobile(classQuery.data, primarySchedule, singleClassPriceEgp)
    : null;
  const activePackages = userPackages.filter((pkg) => pkg.status === "active" && pkg.remainingCredits > 0);
  const packageCreditsRemaining = activePackages.reduce((sum, pkg) => sum + pkg.remainingCredits, 0);
  const selectedPackage = activePackages[0];
  const schedulePackageEligible = primarySchedule?.packageEligible ?? cls?.packageEligible ?? true;
  const canUsePackageCredits = schedulePackageEligible && packageCreditsRemaining > 0;

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
  const [packageParamApplied, setPackageParamApplied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bookingFailed, setBookingFailed] = useState(false);
  const [refCodeInput, setRefCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [refCodeState, setRefCodeState] = useState<"idle" | "valid" | "invalid">("idle");
  const selectedChild = children.find((child) => child.id === selectedChildId);
  const isPackageMode = paymentMethod === "packageCredit" && canUsePackageCredits;
  const isFirstBooking = false;
  const finalPrice = isPackageMode ? 0 : (cls?.price ?? 0);
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

  useEffect(() => {
    if (!selectedChildId && children.length > 0) {
      setSelectedChildId(children[0].id);
    }
  }, [children, selectedChildId]);

  useEffect(() => {
    if (!packageParamApplied && usePackage === "true" && canUsePackageCredits) {
      setPaymentMethod("packageCredit");
      setPackageParamApplied(true);
    } else if (paymentMethod === "packageCredit" && !canUsePackageCredits) {
      setPaymentMethod("cash");
    }
  }, [canUsePackageCredits, packageParamApplied, paymentMethod, usePackage]);

  function handleApplyRefCode() {
    const code = refCodeInput.trim().toUpperCase();
    if (!code) return;
    const valid = /^[A-Z]{2,4}-[A-Z0-9]{4}$/.test(code);
    if (valid) {
      setAppliedCode(code);
      setRefCodeState("valid");
    } else {
      setRefCodeState("invalid");
    }
  }

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
          onPress={() => router.push(nextStepRoute(user.profileCompletion!.nextStep) as never)}
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

  // ── Confirm booking — POST to API then update local state ──
  async function handleConfirm() {
    if (!cls || !user) return;
    if (!hasSchedule) {
      Alert.alert(
        "Schedule not set",
        "This class cannot be booked until the studio adds a day and time.",
      );
      return;
    }
    if (!canBookSchedule) {
      Alert.alert(
        cls.scheduleStatus === "cancelled" ? "Class cancelled" : "Class full",
        cls.scheduleStatus === "cancelled"
          ? "This class schedule has been cancelled and cannot be booked."
          : "This class schedule is full and cannot accept more bookings.",
      );
      return;
    }
    if (paymentMethod === "packageCredit" && !canUsePackageCredits) {
      Alert.alert(
        "Package credits unavailable",
        "This class is not eligible for package credits. Please choose Pay at Studio.",
      );
      setPaymentMethod("cash");
      return;
    }
    if (participantType === "child" && (!participantChildId || !Number.isInteger(participantChildId))) {
      Alert.alert(
        "Child profile unavailable",
        "Please choose a saved child profile before booking.",
      );
      return;
    }
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      const notes = [
        appliedCode ? `Referral code: ${appliedCode}` : null,
        participantType === "child" ? `Participant: ${participantName}` : null,
        isPackageMode && selectedPackage
          ? `Package credit intent: ${selectedPackage.packageTitle} (#${selectedPackage.id})`
          : null,
      ].filter(Boolean).join("\n") || undefined;

      // 1. Create booking in the database
      // Policy: every student booking starts as PENDING — Admin confirms it (and,
      // for package bookings, the credit is deducted only at QR check-in, never at
      // booking time). Pay-on-arrival and package both create a pending request.
      const apiBookingStatus = "pending";
      const apiPaymentStatus = isPackageMode || finalPrice === 0 ? "not_required" : "pending_payment";
      const apiPaymentMode = isPackageMode ? "package_credit" : finalPrice === 0 ? "free" : "pay_at_studio";
      const apiBooking = await createBookingAsync({
        data: {
          studentName: participantName,
          studentEmail: user.email,
          studentPhone: user.phone,
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
        price: finalPrice,
        participantType,
        participantName,
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
        params: { bookingNumber, classId: cls.id },
      });
    } catch (err) {
      setLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Friendly handling for the backend duplicate-booking guard (HTTP 409 /
      // code "duplicate_booking") instead of the generic failure screen.
      const status = (err as { status?: number })?.status;
      const code = (err as { data?: { code?: string } })?.data?.code;
      const msg = err instanceof Error ? err.message : "";
      if (code === "booking_attempt_limit_reached" || /booking_attempt_limit_reached/i.test(msg)) {
        Alert.alert(
          "Booking limit reached",
          "You have reached the daily booking limit for this class. Please contact the studio if you need help.",
        );
        return;
      }
      if (status === 409 || /duplicate_booking|already have an active booking/i.test(msg)) {
        Alert.alert(
          "Already booked",
          "You already have an active booking for this class. You can cancel it from the Classes screen first.",
          [{ text: "OK", onPress: () => router.back() }],
        );
        return;
      }
      setBookingFailed(true);
    }
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
        <TouchableOpacity
          onPress={() => {
            if (step > 1) setStep(step - 1);
            else router.back();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Book Class</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.stepIndicatorWrap}>
        <StepIndicator current={step} total={3} labels={["Participant", "Details", "Payment"]} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}
      >
        {/* ── Step 1: Participant ── */}
        {step === 1 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Who are you booking for?</Text>

            <View style={[styles.summaryCard, { backgroundColor: "#15171B", borderColor: "rgba(255,255,255,0.08)" }]}>
              {[
                { label: "Class", value: cls.title },
                { label: "Schedule", value: getScheduleLabel(cls) },
                { label: "Instructor", value: instructor?.name ?? "Instructor" },
              ].map((row, i, arr) => (
                <React.Fragment key={row.label}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{row.label}</Text>
                    <Text style={styles.summaryValue}>{row.value}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: "rgba(255,255,255,0.08)" }]} />}
                </React.Fragment>
              ))}
            </View>

            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setParticipantType("self"); }}
              style={[
                styles.participantCard,
                participantType === "self" && { borderColor: colors.studio.primary, backgroundColor: colors.studio.primary + "15" },
              ]}
            >
              <ParticipantAvatar type="self" name={user.fullName} avatarUrl={user.avatarUrl} size={48} />
              <View style={styles.participantText}>
                <Text style={[styles.participantLabel, { color: participantType === "self" ? "#FFFFFF" : "#8E97A2" }]}>
                  Myself
                </Text>
                <Text style={styles.participantSub}>{user.fullName}</Text>
              </View>
              {participantType === "self" && (
                <View style={[styles.checkCircle, { backgroundColor: colors.studio.primary }]}>
                  <Ionicons name="checkmark" size={14} color="#000" />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                if (!children.length) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setParticipantType("child");
              }}
              disabled={!children.length}
              style={[
                styles.participantCard,
                participantType === "child" && { borderColor: colors.studio.primary, backgroundColor: colors.studio.primary + "15" },
                !children.length && styles.disabledCard,
              ]}
            >
              <ParticipantAvatar
                type="child"
                name={(selectedChild ?? children[0])?.fullName ?? "Child"}
                gender={(selectedChild ?? children[0])?.gender}
                size={48}
              />
              <View style={styles.participantText}>
                <Text style={[styles.participantLabel, { color: participantType === "child" ? "#FFFFFF" : "#8E97A2" }]}>
                  My Child
                </Text>
                <Text style={styles.participantSub}>
                  {children.length > 0 ? selectedChild?.fullName ?? children[0].fullName : "No children added yet"}
                </Text>
              </View>
              {participantType === "child" && (
                <View style={[styles.checkCircle, { backgroundColor: colors.studio.primary }]}>
                  <Ionicons name="checkmark" size={14} color="#000" />
                </View>
              )}
            </TouchableOpacity>

            {!children.length ? (
              <AppButton
                title="Add Child Profile"
                onPress={() => router.push("/(tabs)/profile" as any)}
                variant="ghost"
                fullWidth
              />
            ) : participantType === "child" ? (
              <View style={styles.childPicker}>
                {children.map((child) => (
                  <TouchableOpacity
                    key={child.id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedChildId(child.id);
                    }}
                    style={[
                      styles.childOption,
                      selectedChildId === child.id && {
                        borderColor: colors.studio.primary,
                        backgroundColor: colors.studio.primary + "12",
                      },
                    ]}
                  >
                    <ParticipantAvatar type="child" name={child.fullName} gender={child.gender} size={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.childName}>{child.fullName}</Text>
                      <Text style={styles.participantSub}>Age {child.age}</Text>
                    </View>
                    {selectedChildId === child.id && (
                      <Ionicons name="checkmark-circle" size={20} color={colors.studio.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <View style={[styles.refCodeSection, { borderColor: "#1E2E38", backgroundColor: "#0E1619" }]}>
              <Text style={styles.refCodeLabel}>
                <Ionicons name="gift-outline" size={13} color={colors.studio.primary} /> Have a referral code?
              </Text>
              {refCodeState === "valid" ? (
                <View style={[styles.refCodeSuccess, { backgroundColor: "#1FB87115", borderColor: "#1FB87140" }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#1FB871" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.refCodeSuccessTitle, { color: "#1FB871" }]}>Referral Applied!</Text>
                    <Text style={styles.refCodeSuccessDesc}>
                      Code {appliedCode ?? refCodeInput.toUpperCase()} — your referrer earns EGP 100 credit.
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.refCodeRow}>
                  <TextInput
                    value={refCodeInput}
                    onChangeText={(t) => { setRefCodeInput(t.toUpperCase()); setRefCodeState("idle"); }}
                    placeholder="e.g. SARA-XK7F"
                    placeholderTextColor="#6B747F"
                    autoCapitalize="characters"
                    style={[
                      styles.refCodeInput,
                      { borderColor: refCodeState === "invalid" ? "#EF4444" : "#1E2E38", color: "#FFFFFF", backgroundColor: "#15171B" },
                    ]}
                  />
                  <TouchableOpacity
                    onPress={handleApplyRefCode}
                    disabled={!refCodeInput.trim()}
                    style={[styles.refCodeBtn, { backgroundColor: refCodeInput.trim() ? colors.studio.primary : "#1E2E38" }]}
                  >
                    <Text style={[styles.refCodeBtnText, { color: refCodeInput.trim() ? "#000" : "#6B747F" }]}>Apply</Text>
                  </TouchableOpacity>
                </View>
              )}
              {refCodeState === "invalid" && (
                <Text style={styles.refCodeError}>Invalid code. Check the format (e.g. SARA-XK7F) and try again.</Text>
              )}
            </View>
          </View>
        )}

        {/* ── Step 2: Details ── */}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Confirm Booking Details</Text>

            <View style={[styles.summaryCard, { backgroundColor: "#15171B", borderColor: "rgba(255,255,255,0.08)" }]}>
              {[
                { label: "Class", value: cls.title },
                { label: "Day & Time", value: getScheduleLabel(cls) },
                { label: "Duration", value: cls.duration },
                { label: "Location", value: cls.location },
                { label: "Participant", value: participantName },
              ].map((row, i, arr) => (
                <React.Fragment key={row.label}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{row.label}</Text>
                    <Text style={styles.summaryValue}>{row.value}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: "rgba(255,255,255,0.08)" }]} />}
                </React.Fragment>
              ))}

              {isFirstBooking && (
                <>
                  <View style={[styles.divider, { backgroundColor: "rgba(255,255,255,0.08)" }]} />
                  <View style={[styles.summaryRow, { backgroundColor: "#00B6D715" }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="pricetag" size={13} color={colors.studio.primary} />
                      <Text style={[styles.summaryLabel, { color: colors.studio.primary }]}>
                        {NEW_MEMBER_OFFER_TITLE}
                      </Text>
                    </View>
                    <Text style={[styles.summaryValue, { color: colors.studio.primary }]}>-100%</Text>
                  </View>
                </>
              )}

              <View style={[styles.divider, { backgroundColor: "rgba(255,255,255,0.08)" }]} />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.studio.primary }]}>
                  {isPackageMode ? "Package Credit" : "Total Price"}
                </Text>
                <View style={styles.priceValueWrap}>
                  {isFirstBooking && !isPackageMode && cls.price > 0 && (
                    <Text style={{ fontSize: 13, fontFamily: "Archivo_400Regular", color: "#6B747F", textDecorationLine: "line-through" }}>
                      EGP {cls.price}
                    </Text>
                  )}
                  <Text style={[styles.summaryValue, { color: colors.studio.primary, fontSize: 18, fontFamily: "Archivo_700Bold" }]}>
                    {isPackageMode ? "Uses 1 credit" : isFirstBooking ? "FREE" : `EGP ${cls.price}`}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Step 3: Payment ── */}
        {step === 3 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>
              {isPackageMode ? "Confirm Package Booking" : isFirstBooking ? "Confirm Free Class" : "Choose Payment Method"}
            </Text>

              {isFirstBooking && !isPackageMode ? (
              <>
              <View style={[styles.summaryCard, { backgroundColor: "#15171B", borderColor: "rgba(255,255,255,0.08)" }]}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Schedule</Text>
                  <Text style={styles.summaryValue}>{getScheduleLabel(cls)}</Text>
                </View>
              </View>
              <LinearGradient
                colors={["#003A47", "#001E28"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.freeCard, { borderColor: colors.studio.primary + "50" }]}
              >
                <View style={[styles.freeIconCircle, { backgroundColor: colors.studio.primary + "20" }]}>
                  <Ionicons name="gift-outline" size={32} color={colors.studio.primary} />
                </View>
                <Text style={[styles.freeTitle, { color: colors.studio.primary }]}>
                  Your First Class Is FREE 🎉
                </Text>
                <Text style={styles.freeDesc}>
                  The <Text style={{ color: "#FFFFFF" }}>New Member Welcome</Text> offer has been automatically applied. No payment needed — just show up and dance!
                </Text>
              </LinearGradient>
              </>
            ) : (
              <>
                <View style={[styles.summaryCard, { backgroundColor: "#15171B", borderColor: "rgba(255,255,255,0.08)" }]}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Schedule</Text>
                    <Text style={styles.summaryValue}>{getScheduleLabel(cls)}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  disabled
                  style={[
                    styles.paymentCard,
                    styles.paymentCardDisabled,
                  ]}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={["#22262C", "#15171B"]}
                    style={styles.paymentGradient}
                  >
                    <View style={styles.paymentTop}>
                      <View style={[styles.paymentIconCircle, { backgroundColor: colors.studio.primary + "20" }]}>
                        <Ionicons name="card-outline" size={24} color={colors.studio.primary} />
                      </View>
                      <View style={[styles.recommendedBadge, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
                        <Text style={[styles.recommendedText, { color: "#8E97A2" }]}>COMING SOON</Text>
                      </View>
                    </View>
                    <Text style={styles.paymentTitle}>Pay Now - Coming Soon</Text>
                    <Text style={styles.paymentDesc}>Online card payments are coming soon.</Text>
                    <Text style={[styles.paymentAmount, { color: colors.studio.primary }]}>EGP {cls.price}</Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPaymentMethod("cash"); }}
                  style={[
                    styles.paymentCard,
                    paymentMethod === "cash" && { borderColor: "#6B747F", backgroundColor: "#22262C" },
                  ]}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={["#15171B", "#0A0B0D"]}
                    style={styles.paymentGradient}
                  >
                    <View style={[styles.paymentIconCircle, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
                      <Ionicons name="business-outline" size={24} color="#8E97A2" />
                    </View>
                    <Text style={[styles.paymentTitle, { color: "#8E97A2" }]}>Pay at Studio</Text>
                    <Text style={styles.paymentDesc}>Pay in cash when you arrive at the studio.</Text>
                  </LinearGradient>
                </TouchableOpacity>

                {canUsePackageCredits && (
                  <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPaymentMethod("packageCredit"); }}
                    style={[
                      styles.paymentCard,
                      paymentMethod === "packageCredit" && { borderColor: colors.studio.primary, backgroundColor: colors.studio.primary + "10" },
                    ]}
                    activeOpacity={0.8}
                  >
                    <LinearGradient
                      colors={paymentMethod === "packageCredit" ? [colors.studio.primary + "20", colors.studio.primary + "05"] : ["#15171B", "#0A0B0D"]}
                      style={styles.paymentGradient}
                    >
                      <View style={styles.paymentTop}>
                        <View style={[styles.paymentIconCircle, { backgroundColor: colors.studio.primary + "20" }]}>
                          <Ionicons name="ticket-outline" size={24} color={colors.studio.primary} />
                        </View>
                        <View style={[styles.recommendedBadge, { backgroundColor: colors.studio.primary }]}>
                          <Text style={styles.recommendedText}>{packageCreditsRemaining} LEFT</Text>
                        </View>
                      </View>
                      <Text style={styles.paymentTitle}>Take From My Credits - {packageCreditsRemaining} left</Text>
                      <Text style={styles.paymentDesc}>Use 1 active package credit for this class.</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}

                {!schedulePackageEligible && packageCreditsRemaining > 0 && (
                  <View style={[styles.warningBanner, { backgroundColor: "#22262C", borderColor: "rgba(255,255,255,0.08)" }]}>
                    <Ionicons name="information-circle-outline" size={16} color="#8E97A2" />
                    <Text style={[styles.warningText, { color: "#8E97A2" }]}>
                      Package credits are not available for this class.
                    </Text>
                  </View>
                )}

                {paymentMethod === "cash" && (
                  <View style={[styles.warningBanner, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "40" }]}>
                    <Ionicons name="warning-outline" size={16} color={colors.warning} />
                    <Text style={[styles.warningText, { color: colors.warning }]}>
                      Your seat is not guaranteed until payment is completed at the studio.
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 12 }]}>
        {step < 3 ? (
          <AppButton
            title={!hasSchedule ? "Schedule Not Set" : canBookSchedule ? "Continue" : cls?.scheduleStatus === "cancelled" ? "Class Cancelled" : "Class Full"}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep(step + 1); }}
            disabled={!canBookSchedule}
            fullWidth
            size="lg"
          />
        ) : (
          <AppButton
            title={isPackageMode ? "Confirm Package Booking" : "Confirm Booking"}
            onPress={handleConfirm}
            loading={loading}
            fullWidth
            size="lg"
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
    paddingHorizontal: 20, paddingBottom: 8,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#22262C", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 16, fontFamily: "Archivo_600SemiBold", color: "#FFFFFF" },
  stepIndicatorWrap: { paddingHorizontal: 20, paddingBottom: 12 },
  scroll: { paddingHorizontal: 20 },
  stepContent: { gap: 14 },
  stepTitle: { fontSize: 24, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF", marginBottom: 4, letterSpacing: -0.3 },
  resultScreen: { alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 18 },
  resultIconRing: { width: 110, height: 110, borderRadius: 55, alignItems: "center", justifyContent: "center" },
  resultIconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 40, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase", textAlign: "center", letterSpacing: 0.5, ...iosDisplayTextStyle(40, 47) },
  resultSub: { fontSize: 14, fontFamily: "Archivo_400Regular", color: INK.text3, textAlign: "center", lineHeight: 21, maxWidth: 300 },
  resultButtons: { width: "100%", gap: 10, marginTop: 8 },
  participantCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)", backgroundColor: "#15171B",
  },
  disabledCard: { opacity: 0.5 },
  participantIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  participantText: { flex: 1 },
  participantLabel: { fontSize: 16, fontFamily: "Archivo_600SemiBold" },
  participantSub: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#6B747F", marginTop: 2 },
  checkCircle: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  childPicker: { gap: 8 },
  childOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0A0B0D",
  },
  childAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  childName: { fontSize: 14, fontFamily: "Archivo_600SemiBold", color: "#FFFFFF" },
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
  refCodeSection: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  refCodeLabel: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: "#FFFFFF" },
  refCodeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  refCodeInput: {
    flex: 1, height: 44, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, fontFamily: "Archivo_600SemiBold", fontSize: 14, letterSpacing: 1,
    ...iosTextInputStyle(14, 18),
  },
  refCodeBtn: { height: 44, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  refCodeBtnText: { fontSize: 13, fontFamily: "Archivo_700Bold" },
  refCodeSuccess: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  refCodeSuccessTitle: { fontSize: 13, fontFamily: "Archivo_600SemiBold" },
  refCodeSuccessDesc: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#8E97A2", marginTop: 2, lineHeight: 16 },
  refCodeError: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#EF4444", lineHeight: 16 },
  freeCard: { borderRadius: 18, borderWidth: 1, padding: 22, alignItems: "center", gap: 14 },
  freeIconCircle: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  freeTitle: { fontSize: 20, fontFamily: "Archivo_700Bold", textAlign: "center" },
  freeDesc: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#8E97A2", textAlign: "center", lineHeight: 20 },
  footer: {
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", backgroundColor: "#0A0B0D",
  },
});
